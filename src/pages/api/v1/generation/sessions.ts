import type { APIRoute } from "astro";
import { z } from "zod";

import { DEFAULT_USER_ID } from "@/db/supabase.client";
import { jsonBadRequest, jsonErrorResponse, jsonInternalServerError } from "@/lib/json-error-response";
import { ErrorAuditService } from "@/lib/services/error-audit.service";
import { listUserSessions } from "@/lib/services/generation-sessions.service";
import { createGenerationSession } from "@/lib/services/generation.service";
import type {
  CreateGenerationSessionRequestDto,
  ListGenerationSessionsCommand,
  ListGenerationSessionsResponseDto,
} from "@/types";

export const prerender = false;

const LIST_ENDPOINT = "/api/v1/generation/sessions" as const;
const LIST_METHOD = "GET" as const;

const listGenerationSessionsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    sort: z.enum(["created_at_desc", "created_at_asc"]).default("created_at_desc"),
  })
  .strict();

export const GET: APIRoute = async ({ request, locals }) => {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const started = performance.now();
  const url = new URL(request.url);

  // TODO(auth): replace DEFAULT_USER_ID with authenticated user id from session/token.
  const userId = DEFAULT_USER_ID;

  const rawQuery = {
    page: url.searchParams.get("page") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
    sort: url.searchParams.get("sort") ?? undefined,
  };

  const parsed = listGenerationSessionsQuerySchema.safeParse(rawQuery);
  if (!parsed.success) {
    const durationMs = Math.round(performance.now() - started);
    const first = parsed.error.issues[0];
    // eslint-disable-next-line no-console -- structured client-error log (plan §6)
    console.warn(`${LIST_METHOD} ${LIST_ENDPOINT} client error`, {
      endpoint: LIST_ENDPOINT,
      method: LIST_METHOD,
      requestId,
      userId,
      statusCode: 400,
      errorCode: "BAD_REQUEST",
      durationMs,
    });
    return jsonBadRequest(first?.message ?? "Invalid query parameters.");
  }

  const q = parsed.data;
  const command: ListGenerationSessionsCommand = {
    userId,
    page: q.page,
    limit: q.limit,
    sort: q.sort,
  };

  try {
    const result = await listUserSessions({ supabase: locals.supabase }, command);

    if (result.kind === "error") {
      const durationMs = Math.round(performance.now() - started);
      ErrorAuditService.record({
        endpoint: LIST_ENDPOINT,
        method: LIST_METHOD,
        requestId,
        userId,
        statusCode: 500,
        errorCode: "DB_READ_FAILED",
        message: result.error.message,
        context: { durationMs },
      });
      // eslint-disable-next-line no-console -- structured server-error log (plan §6)
      console.error(`${LIST_METHOD} ${LIST_ENDPOINT} server error`, {
        endpoint: LIST_ENDPOINT,
        method: LIST_METHOD,
        requestId,
        userId,
        statusCode: 500,
        errorCode: "DB_READ_FAILED",
        durationMs,
      });
      return jsonInternalServerError();
    }

    const { items, total, hasMore } = result.data;

    const payload: ListGenerationSessionsResponseDto = {
      data: items,
      meta: {
        page: q.page,
        limit: q.limit,
        total,
        has_more: hasMore,
      },
    };

    const durationMs = Math.round(performance.now() - started);
    // eslint-disable-next-line no-console -- structured success log (plan §6)
    console.info(`${LIST_METHOD} ${LIST_ENDPOINT} completed`, {
      endpoint: LIST_ENDPOINT,
      method: LIST_METHOD,
      requestId,
      userId,
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
      endpoint: LIST_ENDPOINT,
      method: LIST_METHOD,
      requestId,
      userId,
      statusCode: 500,
      errorCode: "UNHANDLED_EXCEPTION",
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      context: { durationMs },
    });
    // eslint-disable-next-line no-console -- structured server-error log (plan §6)
    console.error(`${LIST_METHOD} ${LIST_ENDPOINT} server error`, {
      endpoint: LIST_ENDPOINT,
      method: LIST_METHOD,
      requestId,
      userId,
      statusCode: 500,
      errorCode: "UNHANDLED_EXCEPTION",
      durationMs,
    });

    return jsonInternalServerError();
  }
};

const createGenerationSessionRequestSchema = z
  .object({
    input_text: z
      .string()
      .transform((value) => value.trim())
      .refine((value) => value.length >= 1000 && value.length <= 10000, {
        message: "input_text length must be between 1000 and 10000 characters.",
      }),
  })
  .strict();

export const POST: APIRoute = async ({ request, locals }) => {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return jsonBadRequest("Invalid JSON body.");
  }

  const parsedBody = createGenerationSessionRequestSchema.safeParse(rawBody);
  if (!parsedBody.success) {
    const firstIssue = parsedBody.error.issues[0];
    return jsonBadRequest(firstIssue?.message ?? "Invalid request body.");
  }

  const body = parsedBody.data satisfies CreateGenerationSessionRequestDto;

  const result = await createGenerationSession(
    { supabase: locals.supabase },
    {
      inputText: body.input_text,
      // TODO(auth): replace DEFAULT_USER_ID with authenticated user id from session/token.
      userId: DEFAULT_USER_ID,
    }
  );

  if (result.kind === "no_proposals") {
    return jsonErrorResponse(422, "NO_PROPOSALS", "No valid proposals could be generated from the input.");
  }

  if (result.kind === "error") {
    ErrorAuditService.record({
      endpoint: "/api/v1/generation/sessions",
      method: "POST",
      requestId,
      userId: DEFAULT_USER_ID,
      statusCode: 500,
      errorCode: "DB_WRITE_FAILED",
      message: result.error.message,
    });

    return jsonInternalServerError();
  }

  // eslint-disable-next-line no-console -- success audit log
  console.info("POST /api/v1/generation/sessions completed", {
    endpoint: "/api/v1/generation/sessions",
    method: "POST",
    requestId,
    userId: DEFAULT_USER_ID,
    inputLength: body.input_text.length,
    sessionId: result.data.session.id,
    proposalCount: result.data.proposals.length,
  });

  return Response.json(
    {
      data: result.data,
    },
    { status: 201 }
  );
};
