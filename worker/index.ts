const LITTERBOX_UPLOAD_URL =
  "https://litterbox.catbox.moe/resources/internals/api.php";

function textResponse(message: string, status: number) {
  return new Response(message, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
    },
  });
}

async function uploadToLitterbox(request: Request) {
  if (request.method !== "POST") {
    return new Response(null, {
      status: 405,
      headers: { allow: "POST" },
    });
  }
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data")) {
    return textResponse("Expected a multipart form upload.", 415);
  }

  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("origin");
  headers.delete("referer");

  try {
    const response = await fetch(LITTERBOX_UPLOAD_URL, {
      method: "POST",
      headers,
      body: request.body,
      redirect: "follow",
    });
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: {
        "cache-control": "no-store",
        "content-type": response.headers.get("content-type") ??
          "text/plain; charset=utf-8",
      },
    });
  } catch (error) {
    console.error(JSON.stringify({
      message: "Litterbox upload failed",
      error: error instanceof Error ? error.message : String(error),
    }));
    return textResponse("Unable to reach the image host.", 502);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/litterbox") {
      return uploadToLitterbox(request);
    }
    if (url.pathname.startsWith("/api/")) {
      return textResponse("Not found.", 404);
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
