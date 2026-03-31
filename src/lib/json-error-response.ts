import type { ApiErrorResponseDto } from "@/types";

const JSON_HEADERS = { "content-type": "application/json" } as const;

/**
 * Standard JSON error body `{ error: { code, message } }` for API routes.
 */
export function jsonErrorResponse(status: number, code: string, message: string): Response {
  const body: ApiErrorResponseDto = {
    error: { code, message },
  };
  return Response.json(body, { status, headers: JSON_HEADERS });
}

export function jsonUnauthorized(message = "Authentication required.", code = "UNAUTHORIZED"): Response {
  return jsonErrorResponse(401, code, message);
}

export function jsonBadRequest(message: string): Response {
  return jsonErrorResponse(400, "BAD_REQUEST", message);
}

export function jsonNotFound(message: string): Response {
  return jsonErrorResponse(404, "NOT_FOUND", message);
}

export function jsonInternalServerError(message = "Internal server error.", code = "INTERNAL_SERVER_ERROR"): Response {
  return jsonErrorResponse(500, code, message);
}
