/**
 * Serves mirrored VIN photos from R2 at imgsv.getcarapi.com.
 * Uploads are done by the API (photo-mirror.ts); this worker only reads.
 */
interface Env {
  PHOTOS: R2Bucket;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405 });
    }

    const url = new URL(request.url);
    const key = url.pathname.replace(/^\/+/, "");
    if (!key || key.includes("..")) {
      return new Response("Bad request", { status: 400 });
    }

    const object = await env.PHOTOS.get(key);
    if (!object) {
      return new Response("Not found", { status: 404 });
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    headers.set(
      "cache-control",
      "public, max-age=31536000, immutable, stale-while-revalidate=86400",
    );
    headers.set("access-control-allow-origin", "*");

    if (request.method === "HEAD") {
      return new Response(null, { status: 200, headers });
    }

    return new Response(object.body, { status: 200, headers });
  },
} satisfies ExportedHandler<Env>;
