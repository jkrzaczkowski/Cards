import type { APIRoute } from "astro";
import { z } from "zod";

import { DEFAULT_USER_ID } from "@/db/supabase.client";
import { jsonBadRequest, jsonInternalServerError, jsonNotFound } from "@/lib/json-error-response";
import { ErrorAuditService } from "@/lib/services/error-audit.service";
import { deleteCard, getCardById, updateCardById } from "@/lib/services/cards.service";
import type {
  DeleteCardInput,
  DeleteCardPathParamsDto,
  GetCardByIdInput,
  GetCardByIdPathParamsDto,
  GetCardByIdResponseDto,
  UpdateCardCommand,
  UpdateCardByIdInput,
  UpdateCardPathParamsDto,
  UpdateCardResponseDto,
} from "@/types";

export const prerender = false;

/** UUID path param for `/api/v1/cards/:cardId` (GET, DELETE, PATCH). */
export const cardIdParamSchema = z.object({
  cardId: z.string().uuid(),
});

/** Partial update: at least one of `front` / `back`; strict — no extra keys. */
export const updateCardSchema = z
  .object({
    front: z.string().max(200).optional(),
    back: z.string().max(500).optional(),
  })
  .strict()
  .refine((v) => v.front !== undefined || v.back !== undefined, {
    message: "At least one of front or back is required.",
  });

export const GET: APIRoute = async ({ params, request, locals }) => {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();

  const parsedParams = cardIdParamSchema.safeParse(params);
  if (!parsedParams.success) {
    return jsonBadRequest("Invalid cardId. Expected UUID.");
  }

  const { cardId } = parsedParams.data satisfies GetCardByIdPathParamsDto;

  const input: GetCardByIdInput = {
    cardId,
    // TODO(auth): replace DEFAULT_USER_ID with authenticated user id from session/token.
    userId: DEFAULT_USER_ID,
  };

  try {
    const result = await getCardById({ supabase: locals.supabase }, input);

    if (result.kind === "not_found") {
      return jsonNotFound("Card not found.");
    }

    if (result.kind === "error") {
      ErrorAuditService.record({
        endpoint: "/api/v1/cards/:cardId",
        method: "GET",
        requestId,
        userId: DEFAULT_USER_ID,
        statusCode: 500,
        errorCode: "DB_READ_FAILED",
        message: result.error.message,
        context: { cardId },
      });

      return jsonInternalServerError();
    }

    return Response.json({ data: result.data } satisfies GetCardByIdResponseDto, { status: 200 });
  } catch (err) {
    ErrorAuditService.record({
      endpoint: "/api/v1/cards/:cardId",
      method: "GET",
      requestId,
      userId: DEFAULT_USER_ID,
      statusCode: 500,
      errorCode: "UNHANDLED_EXCEPTION",
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      context: { cardId },
    });

    return jsonInternalServerError();
  }
};

export const DELETE: APIRoute = async ({ params, request, locals }) => {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();

  const parsedParams = cardIdParamSchema.safeParse(params);
  if (!parsedParams.success) {
    return jsonBadRequest("Invalid cardId. Expected UUID.");
  }

  const { cardId } = parsedParams.data satisfies DeleteCardPathParamsDto;

  const input: DeleteCardInput = {
    cardId,
    // TODO(auth): replace DEFAULT_USER_ID with authenticated user id from session/token.
    userId: DEFAULT_USER_ID,
  };

  const deletionResult = await deleteCard({ supabase: locals.supabase }, input);

  if (deletionResult.kind === "not_found") {
    return jsonNotFound("Card not found.");
  }

  if (deletionResult.kind === "error") {
    ErrorAuditService.record({
      endpoint: "/api/v1/cards/:cardId",
      method: "DELETE",
      requestId,
      userId: DEFAULT_USER_ID,
      statusCode: 500,
      errorCode: "DB_DELETE_FAILED",
      message: deletionResult.error.message,
      context: { cardId },
    });

    return jsonInternalServerError();
  }

  return new Response(null, { status: 204 });
};

export const PATCH: APIRoute = async ({ params, request, locals }) => {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return jsonBadRequest("Content-Type must be application/json.");
  }

  const parsedParams = cardIdParamSchema.safeParse(params);
  if (!parsedParams.success) {
    return jsonBadRequest("Invalid cardId. Expected UUID.");
  }

  const { cardId } = parsedParams.data satisfies UpdateCardPathParamsDto;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return jsonBadRequest("Invalid JSON body.");
  }

  const parsedBody = updateCardSchema.safeParse(rawBody);
  if (!parsedBody.success) {
    const first = parsedBody.error.issues[0];
    return jsonBadRequest(first?.message ?? "Invalid request body.");
  }

  const input: UpdateCardByIdInput = {
    cardId,
    // TODO(auth): replace DEFAULT_USER_ID with authenticated user id from session/token.
    userId: DEFAULT_USER_ID,
    patch: parsedBody.data as UpdateCardCommand,
  };

  try {
    const result = await updateCardById({ supabase: locals.supabase }, input);

    if (result.kind === "not_found") {
      return jsonNotFound("Card not found.");
    }

    if (result.kind === "error") {
      ErrorAuditService.record({
        endpoint: "/api/v1/cards/:cardId",
        method: "PATCH",
        requestId,
        userId: DEFAULT_USER_ID,
        statusCode: 500,
        errorCode: "DB_UPDATE_FAILED",
        message: result.error.message,
        context: { cardId },
      });

      return jsonInternalServerError();
    }

    return Response.json({ data: result.data } satisfies UpdateCardResponseDto, { status: 200 });
  } catch (err) {
    ErrorAuditService.record({
      endpoint: "/api/v1/cards/:cardId",
      method: "PATCH",
      requestId,
      userId: DEFAULT_USER_ID,
      statusCode: 500,
      errorCode: "UNHANDLED_EXCEPTION",
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      context: { cardId },
    });

    return jsonInternalServerError();
  }
};
