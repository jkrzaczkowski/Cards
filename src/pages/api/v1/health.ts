import type { APIRoute } from "astro";

import { jsonInternalServerError } from "@/lib/json-error-response";
import { getHealth } from "@/lib/services/health.service";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();

  try {
    const body = getHealth();
    return Response.json(body, {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  } catch (err) {
    // eslint-disable-next-line no-console -- plan §7: server-side error logging without leaking details to client
    console.error("GET /api/v1/health failed", {
      endpoint: "/api/v1/health",
      method: "GET",
      requestId,
      message: err instanceof Error ? err.message : String(err),
    });
    return jsonInternalServerError();
  }
};
