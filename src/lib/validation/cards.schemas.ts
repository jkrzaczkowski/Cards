import { z } from "zod";

/**
 * Request body for POST /api/v1/cards.
 * `source`, `user_id`, timestamps are not accepted (`.strict()` on items and root).
 */
export const createCardsRequestBodySchema = z
  .object({
    cards: z
      .array(
        z
          .object({
            front: z
              .string()
              .trim()
              .min(1, "front must not be empty after trim")
              .max(200, "front must be at most 200 characters"),
            back: z
              .string()
              .trim()
              .min(1, "back must not be empty after trim")
              .max(500, "back must be at most 500 characters"),
            proposal_id: z
              .union([z.string().uuid({ message: "proposal_id must be a valid UUID" }), z.null()])
              .optional(),
          })
          .strict()
      )
      .min(1, "cards must contain at least 1 item")
      .max(50, "cards must contain at most 50 items"),
  })
  .strict();

export type CreateCardsRequestBodyParsed = z.infer<typeof createCardsRequestBodySchema>;
