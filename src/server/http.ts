export class ServiceError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 503,
  ) {
    super(message);
  }
}
export async function upstreamJson(
  url: string,
  init?: RequestInit,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ServiceError(
      "UPSTREAM_UNREACHABLE",
      "The data source is temporarily unreachable. Try again shortly.",
    );
  }
  if (!response.ok)
    throw new ServiceError(
      response.status === 429 ? "RATE_LIMITED" : "UPSTREAM_ERROR",
      "The data source is temporarily unavailable. Try again shortly.",
    );
  try {
    return await response.json();
  } catch {
    throw new ServiceError(
      "INVALID_DATA",
      "The data source returned an unreadable response.",
    );
  }
}
export function failure(error: unknown): Response {
  const e =
    error instanceof ServiceError
      ? error
      : new ServiceError(
          "UNAVAILABLE",
          "Data is temporarily unavailable. Try again shortly.",
        );
  console.error(JSON.stringify({ event: "api_failure", code: e.code }));
  return Response.json(
    { status: "unavailable", error: { code: e.code, message: e.message } },
    {
      status: e.status,
      headers: {
        "Cache-Control": "no-store",
        ...(e.code === "RATE_LIMITED" ? { "Retry-After": "30" } : {}),
      },
    },
  );
}
