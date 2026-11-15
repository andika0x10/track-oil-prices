import type { APIRoute } from "astro";
import { serveModelAsset } from "../../../../../server/model-assets";
import { failure } from "../../../../../server/http";

export const GET: APIRoute = async ({ params, request }) => {
  try {
    return await serveModelAsset(params.model ?? "", params.revision ?? "", params.file ?? "", request);
  } catch (error) { return failure(error); }
};
