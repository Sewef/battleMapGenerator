/// <reference types="@cloudflare/workers-types" />

import { DurableObject } from "cloudflare:workers";
import {
  MAP_IMAGE_PREFIX,
  MAP_IMAGE_RETENTION_MS,
  MAX_MAP_STORAGE_BYTES,
} from "./map-settings";

export type StoredMapImage = {
  key: string;
  bytes: ArrayBuffer;
  width: number;
  height: number;
  expiresAt: number;
};

type MapStorageEnv = {
  MAP_IMAGES: R2Bucket;
};

type IndexedMapImage = {
  key: string;
  size: number;
};

export class MapStorageCoordinator extends DurableObject<MapStorageEnv> {
  private operationQueue: Promise<void> = Promise.resolve();

  constructor(ctx: DurableObjectState, env: MapStorageEnv) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS map_images (
        key TEXT PRIMARY KEY,
        size INTEGER NOT NULL,
        uploaded_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS map_images_by_age
        ON map_images(uploaded_at, key);
      CREATE TABLE IF NOT EXISTS coordinator_state (
        key TEXT PRIMARY KEY,
        value INTEGER NOT NULL
      );
    `);
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(operation, operation);
    this.operationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  private async initializeIndex() {
    const initialized = this.ctx.storage.sql
      .exec<{ value: number }>(
        "SELECT value FROM coordinator_state WHERE key = 'r2-indexed'",
      )
      .toArray()[0]?.value;
    if (initialized) {
      if (this.stateValue("total-bytes") === undefined) {
        const total = this.ctx.storage.sql
          .exec<{ total: number }>(
            "SELECT COALESCE(SUM(size), 0) AS total FROM map_images",
          )
          .one().total;
        this.setStateValue("total-bytes", total);
      }
      return;
    }

    let cursor: string | undefined;
    let totalBytes = 0;
    do {
      const page = await this.env.MAP_IMAGES.list({
        prefix: MAP_IMAGE_PREFIX,
        cursor,
        limit: 1_000,
        include: ["customMetadata"],
      });
      for (const object of page.objects) {
        const metadataExpiry = Number(object.customMetadata?.expiresAt);
        const expiresAt = Number.isFinite(metadataExpiry)
          ? metadataExpiry
          : object.uploaded.getTime() + MAP_IMAGE_RETENTION_MS;
        this.ctx.storage.sql.exec(
          `INSERT OR REPLACE INTO map_images
            (key, size, uploaded_at, expires_at) VALUES (?, ?, ?, ?)`,
          object.key,
          object.size,
          object.uploaded.getTime(),
          expiresAt,
        );
        totalBytes += object.size;
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        "INSERT OR REPLACE INTO coordinator_state (key, value) VALUES ('r2-indexed', 1)",
      );
      this.setStateValue("total-bytes", totalBytes);
    });
  }

  private stateValue(key: string) {
    return this.ctx.storage.sql
      .exec<{ value: number }>(
        "SELECT value FROM coordinator_state WHERE key = ?",
        key,
      )
      .toArray()[0]?.value;
  }

  private setStateValue(key: string, value: number) {
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO coordinator_state (key, value) VALUES (?, ?)",
      key,
      value,
    );
  }

  private async deleteR2Objects(keys: string[]) {
    for (let offset = 0; offset < keys.length; offset += 1_000) {
      await this.env.MAP_IMAGES.delete(keys.slice(offset, offset + 1_000));
    }
  }

  private removeIndexEntries(keys: string[]) {
    for (const key of keys) {
      this.ctx.storage.sql.exec("DELETE FROM map_images WHERE key = ?", key);
    }
  }

  private commitRemoval(keys: string[], remainingBytes: number) {
    this.ctx.storage.transactionSync(() => {
      this.removeIndexEntries(keys);
      this.setStateValue("total-bytes", Math.max(0, remainingBytes));
    });
  }

  private async evictOldestToFit(additionalBytes: number) {
    let storedBytes = this.stateValue("total-bytes") ?? 0;
    if (storedBytes + additionalBytes <= MAX_MAP_STORAGE_BYTES) return;
    const evicted: string[] = [];
    const oldest = this.ctx.storage.sql.exec<IndexedMapImage>(
      "SELECT key, size FROM map_images ORDER BY uploaded_at ASC, key ASC",
    );
    for (const item of oldest) {
      if (storedBytes + additionalBytes <= MAX_MAP_STORAGE_BYTES) break;
      evicted.push(item.key);
      storedBytes -= item.size;
    }
    if (storedBytes + additionalBytes > MAX_MAP_STORAGE_BYTES) {
      throw new Error("The map image exceeds the total storage capacity.");
    }
    if (evicted.length) {
      await this.deleteR2Objects(evicted);
      this.commitRemoval(evicted, storedBytes);
    }
  }

  async storeImage(image: StoredMapImage): Promise<void> {
    return this.exclusive(async () => {
      await this.initializeIndex();
      await this.evictOldestToFit(0);
      const existing = this.ctx.storage.sql
        .exec<{ expires_at: number; size: number }>(
          "SELECT expires_at, size FROM map_images WHERE key = ?",
          image.key,
        )
        .toArray()[0];
      if (existing?.expires_at && existing.expires_at > Date.now()) return;
      if (existing) {
        await this.env.MAP_IMAGES.delete(image.key);
        this.commitRemoval(
          [image.key],
          (this.stateValue("total-bytes") ?? 0) - existing.size,
        );
      }

      await this.evictOldestToFit(image.bytes.byteLength);

      await this.env.MAP_IMAGES.put(image.key, image.bytes, {
        httpMetadata: { contentType: "image/webp" },
        customMetadata: {
          expiresAt: String(image.expiresAt),
          height: String(image.height),
          width: String(image.width),
        },
      });
      try {
        this.ctx.storage.transactionSync(() => {
          this.ctx.storage.sql.exec(
            `INSERT INTO map_images
              (key, size, uploaded_at, expires_at) VALUES (?, ?, ?, ?)`,
            image.key,
            image.bytes.byteLength,
            Date.now(),
            image.expiresAt,
          );
          this.setStateValue(
            "total-bytes",
            (this.stateValue("total-bytes") ?? 0) + image.bytes.byteLength,
          );
        });
      } catch (error) {
        await this.env.MAP_IMAGES.delete(image.key);
        throw error;
      }
    });
  }

  async deleteImage(key: string): Promise<void> {
    return this.exclusive(async () => {
      await this.initializeIndex();
      const existing = this.ctx.storage.sql
        .exec<{ size: number }>(
          "SELECT size FROM map_images WHERE key = ?",
          key,
        )
        .toArray()[0];
      await this.env.MAP_IMAGES.delete(key);
      if (existing) {
        this.commitRemoval(
          [key],
          (this.stateValue("total-bytes") ?? 0) - existing.size,
        );
      } else {
        this.removeIndexEntries([key]);
      }
    });
  }

  async removeExpiredImages(now: number): Promise<void> {
    return this.exclusive(async () => {
      await this.initializeIndex();
      const expired = this.ctx.storage.sql
        .exec<IndexedMapImage>(
          "SELECT key, size FROM map_images WHERE expires_at <= ?",
          now,
        )
        .toArray()
      const expiredKeys = expired.map(({ key }) => key);
      if (expiredKeys.length) {
        await this.deleteR2Objects(expiredKeys);
        const removedBytes = expired.reduce((total, item) => total + item.size, 0);
        this.commitRemoval(
          expiredKeys,
          (this.stateValue("total-bytes") ?? 0) - removedBytes,
        );
      }
      await this.evictOldestToFit(0);
    });
  }
}
