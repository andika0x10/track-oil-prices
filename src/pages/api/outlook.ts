import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { getOutlook } from "../../server/outlook";
import { failure } from "../../server/http";
export const GET: APIRoute = async () => {
  try {
    return Response.json(await getOutlook(env), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return failure(error);
  }
};
