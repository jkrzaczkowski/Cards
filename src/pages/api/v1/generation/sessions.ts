import type { APIRoute } from "astro";
import { z } from "zod";

import { DEFAULT_USER_ID } from "@/db/supabase.client";
import { createGenerationSession } from "@/lib/services/generation.service";
import type { CreateGenerationSessionRequestDto } from "@/types";

export const prerender = false;

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

const badRequest = (message: string) =>
  Response.json(
    {
      error: {
        code: "BAD_REQUEST",
        message,
      },
    },
    { status: 400 },
  );

export const POST: APIRoute = async ({ request, locals }) => {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const parsedBody = createGenerationSessionRequestSchema.safeParse(rawBody);
  if (!parsedBody.success) {
    const firstIssue = parsedBody.error.issues[0];
    return badRequest(firstIssue?.message ?? "Invalid request body.");
  }

  const body = parsedBody.data satisfies CreateGenerationSessionRequestDto;

  const result = await createGenerationSession(
    { supabase: locals.supabase },
    {
      inputText: body.input_text,
      // TODO(auth): replace DEFAULT_USER_ID with authenticated user id from session/token.
      userId: DEFAULT_USER_ID,
    },
  );

  if (result.kind === "no_proposals") {
    return Response.json(
      {
        error: {
          code: "NO_PROPOSALS",
          message: "No valid proposals could be generated from the input.",
        },
      },
      { status: 422 },
    );
  }

  if (result.kind === "error") {
    console.error("Create generation session failed", {
      endpoint: "/api/v1/generation/sessions",
      method: "POST",
      requestId,
      userId: DEFAULT_USER_ID,
      errorCode: "DB_WRITE_FAILED",
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
    { status: 201 },
  );
};
