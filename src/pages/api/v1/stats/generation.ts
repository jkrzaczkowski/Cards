import type { APIRoute } from "astro";

import { DEFAULT_USER_ID } from "@/db/supabase.client";
import { jsonInternalServerError } from "@/lib/json-error-response";
import { ErrorAuditService } from "@/lib/services/error-audit.service";
import { getGenerationStatsForUser } from "@/lib/services/generation-stats.service";
import type { GetGenerationStatsResponseDto } from "@/types";

export const prerender = false;

export const GET: APIRoute = async ({ request, locals }) => {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const started = performance.now();

  // TODO(auth): replace DEFAULT_USER_ID with authenticated user id from session/token.
  const userId = DEFAULT_USER_ID;

  try {
    const result = await getGenerationStatsForUser({ supabase: locals.supabase }, { userId });

    if (result.kind === "error") {
      const durationMs = Math.round(performance.now() - started);
      ErrorAuditService.record({
        endpoint: "/api/v1/stats/generation",
        method: "GET",
        requestId,
        userId,
        statusCode: 500,
        errorCode: "DB_READ_FAILED",
        message: result.error.message,
        context: { durationMs },
      });

      return jsonInternalServerError();
    }

    const { totalGenerated, totalAccepted, sessionCount } = result.data;

    const payload: GetGenerationStatsResponseDto = {
      data: {
        total_generated: totalGenerated,
        total_accepted: totalAccepted,
        session_count: sessionCount,
      },
    };

    const durationMs = Math.round(performance.now() - started);
    // eslint-disable-next-line no-console -- technical timing for monitoring (plan §7)
    console.info("GET /api/v1/stats/generation completed", {
      endpoint: "/api/v1/stats/generation",
      method: "GET",
      requestId,
      userId,
      statusCode: 200,
      durationMs,
    });

    return Response.json(payload, {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    const durationMs = Math.round(performance.now() - started);
    ErrorAuditService.record({
      endpoint: "/api/v1/stats/generation",
      method: "GET",
      requestId,
      userId,
      statusCode: 500,
      errorCode: "UNHANDLED_EXCEPTION",
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      context: { durationMs },
    });

    return jsonInternalServerError();
  }
};
