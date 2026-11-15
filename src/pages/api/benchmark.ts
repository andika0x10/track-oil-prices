import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { getBenchmark } from "../../server/benchmark";
import { failure } from "../../server/http";

export const GET: APIRoute = async () => {
  try {
    return Response.json(await getBenchmark(env), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return failure(error);
  }
};
