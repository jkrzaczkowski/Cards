import type { APIRoute } from "astro";
import { z } from "zod";

import { DEFAULT_USER_ID } from "@/db/supabase.client";
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
    return Response.json(
      {
        error: {
          code: "BAD_REQUEST",
          message: "Invalid cardId. Expected UUID.",
        },
      },
      { status: 400 },
    );
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
      return Response.json(
        {
          error: {
            code: "NOT_FOUND",
            message: "Card not found.",
          },
        },
        { status: 404 },
      );
    }

    if (result.kind === "error") {
      console.error("Get card failed", {
        endpoint: "/api/v1/cards/:cardId",
        method: "GET",
        requestId,
        cardId,
        userId: DEFAULT_USER_ID,
        errorCode: "DB_READ_FAILED",
        message: result.error.message,
      });

      return Response.json(
        {
          error: {
            code: "INTERNAL_SERVER_ERROR",
            message: "Internal server error.",
          },
        },
        { status: 500 },
      );
    }

    return Response.json(
      { data: result.data } satisfies GetCardByIdResponseDto,
      { status: 200 },
    );
  } catch (err) {
    console.error("Get card failed", {
      endpoint: "/api/v1/cards/:cardId",
      method: "GET",
      requestId,
      cardId,
      userId: DEFAULT_USER_ID,
      errorCode: "UNHANDLED_EXCEPTION",
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });

    return Response.json(
      {
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Internal server error.",
        },
      },
      { status: 500 },
    );
  }
};

export const DELETE: APIRoute = async ({ params, request, locals }) => {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();

  const parsedParams = cardIdPathParamsSchema.safeParse(params);
  if (!parsedParams.success) {
    return Response.json(
      {
        error: {
          code: "BAD_REQUEST",
          message: "Invalid cardId. Expected UUID.",
        },
      },
      { status: 400 },
    );
  }

  const { cardId } = parsedParams.data satisfies DeleteCardPathParamsDto;

  const input: DeleteCardInput = {
    cardId,
    // TODO(auth): replace DEFAULT_USER_ID with authenticated user id from session/token.
    userId: DEFAULT_USER_ID,
  };

  const deletionResult = await deleteCard({ supabase: locals.supabase }, input);

  if (deletionResult.kind === "not_found") {
    return Response.json(
      {
        error: {
          code: "NOT_FOUND",
          message: "Card not found.",
        },
      },
      { status: 404 },
    );
  }

  if (deletionResult.kind === "error") {
    console.error("Delete card failed", {
      endpoint: "/api/v1/cards/:cardId",
      method: "DELETE",
      requestId,
      cardId,
      userId: DEFAULT_USER_ID,
      errorCode: "DB_DELETE_FAILED",
      message: deletionResult.error.message,
    });

    return Response.json(
      {
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Internal server error.",
        },
      },
      { status: 500 },
    );
  }

  return new Response(null, { status: 204 });
};
