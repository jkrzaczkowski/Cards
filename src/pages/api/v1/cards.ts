import type { APIRoute } from "astro";
import { z } from "zod";

import { DEFAULT_USER_ID } from "@/db/supabase.client";
import { jsonBadRequest, jsonInternalServerError } from "@/lib/json-error-response";
import { ErrorAuditService } from "@/lib/services/error-audit.service";
import { listUserCards } from "@/lib/services/cards.service";
import type { ListCardsCommand, ListCardsResponseDto } from "@/types";

export const prerender = false;

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
