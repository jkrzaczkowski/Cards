import type { APIRoute } from "astro";
import { z } from "zod";

import { DEFAULT_USER_ID } from "@/db/supabase.client";
import { jsonBadRequest, jsonErrorResponse, jsonInternalServerError } from "@/lib/json-error-response";
import { ErrorAuditService } from "@/lib/services/error-audit.service";
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
