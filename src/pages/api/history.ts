import type { APIRoute } from "astro";
import { getHistory } from "../../server/hyperliquid";
import { failure } from "../../server/http";
export const GET: APIRoute = async ({ url }) => {
  try {
    return Response.json(
      await getHistory(url.searchParams.get("range") || "1M"),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
};
