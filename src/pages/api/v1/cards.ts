import type { APIRoute } from "astro";
import { z } from "zod";

import { DEFAULT_USER_ID } from "@/db/supabase.client";
import { jsonBadRequest, jsonInternalServerError, jsonNotFound } from "@/lib/json-error-response";
import { ErrorAuditService } from "@/lib/services/error-audit.service";
import { createCardsForUser, listUserCards } from "@/lib/services/cards.service";
import { createCardsRequestBodySchema } from "@/lib/validation/cards.schemas";
import type { CreateCardsInput, CreateCardsResponseDto, ListCardsCommand, ListCardsResponseDto } from "@/types";

export const prerender = false;

const POST_ENDPOINT = "/api/v1/cards" as const;
const POST_METHOD = "POST" as const;

const listCardsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    sort: z.enum(["created_at_desc", "created_at_asc", "updated_at_desc"]).default("created_at_desc"),
    cursor: z.string().uuid().optional(),
  })
  .strict();

export const GET: APIRoute = async ({ request, locals }) => {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const url = new URL(request.url);

  const rawQuery = {
    page: url.searchParams.get("page") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
    sort: url.searchParams.get("sort") ?? undefined,
    cursor: url.searchParams.get("cursor") ?? undefined,
  };

  const parsed = listCardsQuerySchema.safeParse(rawQuery);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return jsonBadRequest(first?.message ?? "Invalid query parameters.");
  }

  const q = parsed.data;
  const mode: ListCardsCommand["mode"] = q.cursor ? "cursor" : "page";

  const command: ListCardsCommand = {
    // TODO(auth): replace DEFAULT_USER_ID with authenticated user id from session/token.
    userId: DEFAULT_USER_ID,
    limit: q.limit,
    sort: q.sort,
    mode,
    page: q.page,
    cursor: q.cursor,
  };

  try {
    const result = await listUserCards({ supabase: locals.supabase }, command);

    if (result.kind === "invalid_cursor") {
      return jsonBadRequest("Invalid cursor.");
    }

    if (result.kind === "error") {
      ErrorAuditService.record({
        endpoint: "/api/v1/cards",
        method: "GET",
        requestId,
        userId: DEFAULT_USER_ID,
        statusCode: 500,
        errorCode: "DB_READ_FAILED",
        message: result.error.message,
      });

      return jsonInternalServerError();
    }

    const { items, total, hasMore, page: responsePage } = result.data;

    const payload: ListCardsResponseDto = {
      data: items,
      meta: {
        page: responsePage,
        limit: q.limit,
        total,
        has_more: hasMore,
      },
    };

    return Response.json(payload, {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    ErrorAuditService.record({
      endpoint: "/api/v1/cards",
      method: "GET",
      requestId,
      userId: DEFAULT_USER_ID,
      statusCode: 500,
      errorCode: "UNHANDLED_EXCEPTION",
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });

    return jsonInternalServerError();
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const started = performance.now();

  // TODO(auth): replace DEFAULT_USER_ID with authenticated user id from session/token.
  const userId = DEFAULT_USER_ID;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonBadRequest("Invalid JSON body.");
  }

  const parsed = createCardsRequestBodySchema.safeParse(body);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    const durationMs = Math.round(performance.now() - started);
    // eslint-disable-next-line no-console -- structured client-error log (plan §6)
    console.warn(`${POST_METHOD} ${POST_ENDPOINT} client error`, {
      endpoint: POST_ENDPOINT,
      method: POST_METHOD,
      requestId,
      userId,
      statusCode: 400,
      errorCode: "BAD_REQUEST",
      durationMs,
    });
    return jsonBadRequest(firstIssue?.message ?? "Validation failed.");
  }

  const command: CreateCardsInput = {
    cards: parsed.data.cards.map((c) => ({
      front: c.front,
      back: c.back,
      proposalId: c.proposal_id ?? null,
    })),
  };

  try {
    const result = await createCardsForUser({ supabase: locals.supabase }, userId, command);

    if (result.kind === "bad_request") {
      const durationMs = Math.round(performance.now() - started);
      // eslint-disable-next-line no-console -- structured client-error log (plan §6)
      console.warn(`${POST_METHOD} ${POST_ENDPOINT} client error`, {
        endpoint: POST_ENDPOINT,
        method: POST_METHOD,
        requestId,
        userId,
        statusCode: 400,
        errorCode: "BAD_REQUEST",
        cardCount: command.cards.length,
        durationMs,
      });
      return jsonBadRequest(result.message);
    }

    if (result.kind === "not_found") {
      const durationMs = Math.round(performance.now() - started);
      // eslint-disable-next-line no-console -- structured client-error log (plan §6)
      console.warn(`${POST_METHOD} ${POST_ENDPOINT} client error`, {
        endpoint: POST_ENDPOINT,
        method: POST_METHOD,
        requestId,
        userId,
        statusCode: 404,
        errorCode: "NOT_FOUND",
        cardCount: command.cards.length,
        durationMs,
      });
      return jsonNotFound("One or more proposals were not found or are not accessible.");
    }

    if (result.kind === "error") {
      const durationMs = Math.round(performance.now() - started);
      ErrorAuditService.record({
        endpoint: POST_ENDPOINT,
        method: POST_METHOD,
        requestId,
        userId,
        statusCode: 500,
        errorCode: "DB_WRITE_FAILED",
        message: result.error.message,
        context: { cardCount: command.cards.length, durationMs },
      });
      // eslint-disable-next-line no-console -- structured server-error log (plan §6)
      console.error(`${POST_METHOD} ${POST_ENDPOINT} server error`, {
        endpoint: POST_ENDPOINT,
        method: POST_METHOD,
        requestId,
        userId,
        statusCode: 500,
        errorCode: "DB_WRITE_FAILED",
        cardCount: command.cards.length,
        durationMs,
      });
      return jsonInternalServerError();
    }

    const payload: CreateCardsResponseDto = { data: result.data };
    const durationMs = Math.round(performance.now() - started);

    // eslint-disable-next-line no-console -- structured success log (plan §6)
    console.info(`${POST_METHOD} ${POST_ENDPOINT} completed`, {
      endpoint: POST_ENDPOINT,
      method: POST_METHOD,
      requestId,
      userId,
      statusCode: 201,
      cardCount: command.cards.length,
      durationMs,
    });

    return Response.json(payload, {
      status: 201,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  } catch (err) {
    const durationMs = Math.round(performance.now() - started);
    ErrorAuditService.record({
      endpoint: POST_ENDPOINT,
      method: POST_METHOD,
      requestId,
      userId,
      statusCode: 500,
      errorCode: "UNHANDLED_EXCEPTION",
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      context: { durationMs },
    });
    // eslint-disable-next-line no-console -- structured server-error log (plan §6)
    console.error(`${POST_METHOD} ${POST_ENDPOINT} server error`, {
      endpoint: POST_ENDPOINT,
      method: POST_METHOD,
      requestId,
      userId,
      statusCode: 500,
      errorCode: "UNHANDLED_EXCEPTION",
      durationMs,
    });

    return jsonInternalServerError();
  }
};
