import type { APIRoute } from "astro";
import { serveRuntimeAsset } from "../../../../server/model-assets";
import { failure } from "../../../../server/http";

export const GET: APIRoute = async ({ params, request }) => {
  try {
    return await serveRuntimeAsset(params.version ?? "", params.file ?? "", request);
  } catch (error) { return failure(error); }
};
