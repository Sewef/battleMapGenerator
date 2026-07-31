/// <reference types="@cloudflare/workers-types" />

import { DurableObject } from "cloudflare:workers";

const MAP_IMAGE_PREFIX = "generated-maps/";
const MAP_IMAGE_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_MAP_STORAGE_BYTES = 5 * 1024 * 1024 * 1024;

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
  uploadedAt: number;
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
    if (initialized) return;

    let cursor: string | undefined;
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
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO coordinator_state (key, value) VALUES ('r2-indexed', 1)",
    );
  }

  private indexedImages() {
    return this.ctx.storage.sql
      .exec<{
        key: string;
        size: number;
        uploaded_at: number;
      }>(
        `SELECT key, size, uploaded_at
         FROM map_images ORDER BY uploaded_at ASC, key ASC`,
      )
      .toArray()
      .map((row): IndexedMapImage => ({
        key: row.key,
        size: row.size,
        uploadedAt: row.uploaded_at,
      }));
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

  private async evictOldestToFit(additionalBytes: number) {
    const indexed = this.indexedImages();
    let storedBytes = indexed.reduce((total, item) => total + item.size, 0);
    const evicted: string[] = [];
    for (const item of indexed) {
      if (storedBytes + additionalBytes <= MAX_MAP_STORAGE_BYTES) break;
      evicted.push(item.key);
      storedBytes -= item.size;
    }
    if (storedBytes + additionalBytes > MAX_MAP_STORAGE_BYTES) {
      throw new Error("The map image exceeds the total storage capacity.");
    }
    if (evicted.length) {
      await this.deleteR2Objects(evicted);
      this.removeIndexEntries(evicted);
    }
  }

  async storeImage(image: StoredMapImage): Promise<void> {
    return this.exclusive(async () => {
      await this.initializeIndex();
      await this.evictOldestToFit(0);
      const existing = this.ctx.storage.sql
        .exec<{ expires_at: number }>(
          "SELECT expires_at FROM map_images WHERE key = ?",
          image.key,
        )
        .toArray()[0];
      if (existing?.expires_at && existing.expires_at > Date.now()) return;
      if (existing) {
        await this.env.MAP_IMAGES.delete(image.key);
        this.removeIndexEntries([image.key]);
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
        this.ctx.storage.sql.exec(
          `INSERT INTO map_images
            (key, size, uploaded_at, expires_at) VALUES (?, ?, ?, ?)`,
          image.key,
          image.bytes.byteLength,
          Date.now(),
          image.expiresAt,
        );
      } catch (error) {
        await this.env.MAP_IMAGES.delete(image.key);
        throw error;
      }
    });
  }

  async deleteImage(key: string): Promise<void> {
    return this.exclusive(async () => {
      await this.initializeIndex();
      await this.env.MAP_IMAGES.delete(key);
      this.removeIndexEntries([key]);
    });
  }

  async removeExpiredImages(now: number): Promise<void> {
    return this.exclusive(async () => {
      await this.initializeIndex();
      const expired = this.ctx.storage.sql
        .exec<{ key: string }>(
          "SELECT key FROM map_images WHERE expires_at <= ?",
          now,
        )
        .toArray()
        .map(({ key }) => key);
      if (expired.length) {
        await this.deleteR2Objects(expired);
        this.removeIndexEntries(expired);
      }
      await this.evictOldestToFit(0);
    });
  }
}
