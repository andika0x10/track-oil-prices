import type { APIRoute } from "astro";
import { getMarket } from "../../server/hyperliquid";
import { failure } from "../../server/http";
export const GET: APIRoute = async () => {
  try {
    return Response.json(await getMarket(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return failure(error);
  }
};
