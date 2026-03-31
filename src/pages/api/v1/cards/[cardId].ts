import type { APIRoute } from "astro";
import { z } from "zod";

import { DEFAULT_USER_ID } from "@/db/supabase.client";
import { jsonBadRequest, jsonInternalServerError, jsonNotFound } from "@/lib/json-error-response";
import { ErrorAuditService } from "@/lib/services/error-audit.service";
import { deleteCard, getCardById } from "@/lib/services/cards.service";
import type {
  DeleteCardInput,
  DeleteCardPathParamsDto,
  GetCardByIdInput,
  GetCardByIdPathParamsDto,
  GetCardByIdResponseDto,
} from "@/types";

export const prerender = false;

const cardIdPathParamsSchema = z.object({
  cardId: z.string().uuid(),
});

export const GET: APIRoute = async ({ params, request, locals }) => {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();

  const parsedParams = cardIdPathParamsSchema.safeParse(params);
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

  const parsedParams = cardIdPathParamsSchema.safeParse(params);
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
