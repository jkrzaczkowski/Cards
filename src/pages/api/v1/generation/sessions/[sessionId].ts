import type { APIRoute } from "astro";
import { z } from "zod";

import { DEFAULT_USER_ID } from "@/db/supabase.client";
import { jsonBadRequest, jsonInternalServerError, jsonNotFound } from "@/lib/json-error-response";
import { ErrorAuditService } from "@/lib/services/error-audit.service";
import { getGenerationSessionById } from "@/lib/services/generation-sessions.service";
import type { GetGenerationSessionPathParamsDto, GetGenerationSessionResponseDto } from "@/types";

export const prerender = false;

const ENDPOINT = "/api/v1/generation/sessions/:sessionId" as const;
const METHOD = "GET" as const;

const sessionIdPathParamsSchema = z.object({
  sessionId: z.string().uuid(),
});

export const GET: APIRoute = async ({ params, request, locals }) => {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const started = performance.now();

  // TODO(auth): replace DEFAULT_USER_ID with authenticated user id from session/token.
  const userId = DEFAULT_USER_ID;

  const parsedParams = sessionIdPathParamsSchema.safeParse(params);
  if (!parsedParams.success) {
    const durationMs = Math.round(performance.now() - started);
    const firstIssue = parsedParams.error.issues[0];
    // eslint-disable-next-line no-console -- structured client-error log (plan §6)
    console.warn(`${METHOD} ${ENDPOINT} client error`, {
      endpoint: ENDPOINT,
      method: METHOD,
      requestId,
      userId,
      statusCode: 400,
      errorCode: "BAD_REQUEST",
      sessionId: typeof params?.sessionId === "string" ? params.sessionId : undefined,
      durationMs,
    });
    return jsonBadRequest(firstIssue?.message ?? "Invalid sessionId. Expected UUID.");
  }

  const { sessionId } = parsedParams.data satisfies GetGenerationSessionPathParamsDto;

  try {
    const result = await getGenerationSessionById({ supabase: locals.supabase }, { sessionId, userId });

    if (result.kind === "not_found") {
      const durationMs = Math.round(performance.now() - started);
      // eslint-disable-next-line no-console -- structured client-error log (plan §6)
      console.warn(`${METHOD} ${ENDPOINT} client error`, {
        endpoint: ENDPOINT,
        method: METHOD,
        requestId,
        userId,
        statusCode: 404,
        errorCode: "NOT_FOUND",
        sessionId,
        durationMs,
      });
      return jsonNotFound("Session not found.");
    }

    if (result.kind === "error") {
      const durationMs = Math.round(performance.now() - started);
      ErrorAuditService.record({
        endpoint: ENDPOINT,
        method: METHOD,
        requestId,
        userId,
        statusCode: 500,
        errorCode: "DB_READ_FAILED",
        message: result.error.message,
        context: { sessionId, durationMs },
      });
      // eslint-disable-next-line no-console -- structured server-error log (plan §6)
      console.error(`${METHOD} ${ENDPOINT} server error`, {
        endpoint: ENDPOINT,
        method: METHOD,
        requestId,
        userId,
        statusCode: 500,
        errorCode: "DB_READ_FAILED",
        sessionId,
        durationMs,
      });
      return jsonInternalServerError();
    }

    const payload: GetGenerationSessionResponseDto = { data: result.data };
    const durationMs = Math.round(performance.now() - started);

    // eslint-disable-next-line no-console -- structured success log (plan §6)
    console.info(`${METHOD} ${ENDPOINT} completed`, {
      endpoint: ENDPOINT,
      method: METHOD,
      requestId,
      userId,
      sessionId,
      statusCode: 200,
      durationMs,
    });

    return Response.json(payload, {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  } catch (err) {
    const durationMs = Math.round(performance.now() - started);
    ErrorAuditService.record({
      endpoint: ENDPOINT,
      method: METHOD,
      requestId,
      userId,
      statusCode: 500,
      errorCode: "UNHANDLED_EXCEPTION",
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      context: { sessionId, durationMs },
    });
    // eslint-disable-next-line no-console -- structured server-error log (plan §6)
    console.error(`${METHOD} ${ENDPOINT} server error`, {
      endpoint: ENDPOINT,
      method: METHOD,
      requestId,
      userId,
      statusCode: 500,
      errorCode: "UNHANDLED_EXCEPTION",
      sessionId,
      durationMs,
    });

    return jsonInternalServerError();
  }
};
