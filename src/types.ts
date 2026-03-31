import type { Tables, TablesInsert, TablesUpdate } from "./db/database.types";

/**
 * Base entities derived from database models.
 */
export type CardEntity = Tables<"cards">;
export type CardProposalEntity = Tables<"card_proposals">;
export type GenerationSessionEntity = Tables<"generation_sessions">;

export type CardInsertEntity = TablesInsert<"cards">;
export type CardUpdateEntity = TablesUpdate<"cards">;
export type CardProposalInsertEntity = TablesInsert<"card_proposals">;
export type GenerationSessionInsertEntity = TablesInsert<"generation_sessions">;

/**
 * `cards.source` is currently typed as string in DB generated types,
 * but API contract narrows it to these allowed values.
 */
export type CardSource = "manual" | "ai_generated";

/**
 * Shared API DTO helpers.
 */
export type ApiDataResponse<TData> = {
  data: TData;
};

export type ApiErrorDto = {
  code: string;
  message: string;
};

export type ApiErrorResponseDto = {
  error: ApiErrorDto;
};

export type PaginationMetaDto = {
  /**
   * Always present for response shape consistency.
   * In cursor-based mode this value is conventional (typically 1),
   * while `has_more` + cursor navigation drive pagination flow.
   */
  page: number;
  limit: number;
  total: number;
  has_more: boolean;
};

export type PaginatedResponseDto<TData> = {
  data: TData[];
  meta: PaginationMetaDto;
};

/**
 * Card DTOs and request models.
 */
export type CardDto = Omit<CardEntity, "user_id" | "source"> & {
  source: CardSource;
};

export type ListCardsQueryDto = {
  page?: number;
  limit?: number;
  sort?: "created_at_desc" | "created_at_asc" | "updated_at_desc";
  cursor?: string;
};

export type ListCardsCommand = {
  userId: string;
  limit: number;
  sort: NonNullable<ListCardsQueryDto["sort"]>;
  mode: "page" | "cursor";
  page?: number;
  cursor?: string;
};

export type ListCardsResult = {
  items: CardDto[];
  total: number;
  hasMore: boolean;
  page: number;
};

export type ListCardsResponseDto = PaginatedResponseDto<CardDto>;

/**
 * API request DTOs keep snake_case to match JSON contracts.
 * Path params and internal service inputs use camelCase.
 */
export type CreateCardItemRequestDto = Pick<CardInsertEntity, "front" | "back"> & {
  /**
   * Not stored in `cards`; used by API to link accepted AI proposal
   * and update `generation_sessions.accepted_count`.
   * If present, server stores card with `source = "ai_generated"`;
   * otherwise server stores `source = "manual"`.
   */
  proposal_id?: CardProposalEntity["id"] | null;
};

export type CreateCardsRequestDto = {
  cards: CreateCardItemRequestDto[];
};

export type CreateCardsResponseDto = ApiDataResponse<CardDto[]>;

export type GetCardByIdResponseDto = ApiDataResponse<CardDto>;

type AtLeastOne<T, Keys extends keyof T = keyof T> = Keys extends keyof T
  ? Required<Pick<T, Keys>> & Partial<Omit<T, Keys>>
  : never;

export type UpdateCardRequestDto = AtLeastOne<{
  front?: string;
  back?: string;
}>;
export type UpdateCardInput = UpdateCardRequestDto;

export type UpdateCardResponseDto = ApiDataResponse<CardDto>;

/**
 * Generation session and proposals DTOs/Commands.
 */
export type GenerationSessionDto = Omit<GenerationSessionEntity, "user_id">;

export type CardProposalDto = CardProposalEntity;

export type CreateGenerationSessionRequestDto = {
  input_text: string;
};

export type GenerationSessionWithProposalsDto = {
  session: GenerationSessionDto;
  proposals: CardProposalDto[];
};

export type CreateGenerationSessionResponseDto = ApiDataResponse<GenerationSessionWithProposalsDto>;

export type ListGenerationSessionsQueryDto = {
  page?: number;
  limit?: number;
  sort?: "created_at_desc" | "created_at_asc";
};

export type ListGenerationSessionsResponseDto = PaginatedResponseDto<GenerationSessionDto>;

export type ListGenerationSessionsCommand = {
  userId: string;
  page: number;
  limit: number;
  sort: NonNullable<ListGenerationSessionsQueryDto["sort"]>;
};

export type ListGenerationSessionsResult = {
  items: GenerationSessionDto[];
  total: number;
  hasMore: boolean;
};

export type GetGenerationSessionResponseDto = ApiDataResponse<GenerationSessionWithProposalsDto>;

/**
 * Optional endpoint from API plan:
 * POST /api/v1/generation/sessions/:sessionId/proposals/delete
 */
export type DeleteProposalsRequestDto = {
  proposal_ids: CardProposalEntity["id"][];
};

/**
 * Internal service-layer inputs use camelCase.
 */
export type CreateCardItemInput = Pick<CardInsertEntity, "front" | "back"> & {
  proposalId?: CardProposalEntity["id"] | null;
};

export type CreateCardsInput = {
  cards: CreateCardItemInput[];
};

export type CreateGenerationSessionInput = {
  inputText: string;
};

export type DeleteProposalsInput = {
  proposalIds: CardProposalEntity["id"][];
};

export type GetGenerationStatsInput = {
  userId: string;
};

export type CardIdPathParamsDto = {
  cardId: string;
};

export type GetCardByIdPathParamsDto = CardIdPathParamsDto;
export type DeleteCardPathParamsDto = CardIdPathParamsDto;
export type UpdateCardPathParamsDto = CardIdPathParamsDto;

export type GenerationSessionIdPathParamsDto = {
  sessionId: string;
};

export type GetGenerationSessionPathParamsDto = GenerationSessionIdPathParamsDto;
export type DeleteProposalsPathParamsDto = GenerationSessionIdPathParamsDto;

export type GetGenerationSessionByIdInput = {
  sessionId: string;
  userId: string;
};

export type GetGenerationSessionByIdResult =
  | {
      kind: "found";
      data: GenerationSessionWithProposalsDto;
    }
  | {
      kind: "not_found";
    };

export type GetCardByIdInput = {
  cardId: string;
  userId: string;
};

export type GetCardByIdResult =
  | {
      kind: "found";
      data: CardDto;
    }
  | {
      kind: "not_found";
    }
  | {
      kind: "error";
      error: Error;
    };

export type DeleteCardInput = {
  cardId: string;
  userId: string;
};

/**
 * Account DTOs.
 * DELETE /api/v1/account returns 204 No Content in API plan.
 */
export type DeleteAccountPathParamsDto = Record<string, never>;
export type DeleteAccountInput = {
  userId: string;
};

/**
 * Backward-compatible aliases for previous naming.
 * Prefer *RequestDto for API and *Input for internal services.
 */
export type CreateCardItemCommand = CreateCardItemRequestDto;
export type CreateCardsCommand = CreateCardsRequestDto;
export type UpdateCardCommand = UpdateCardRequestDto;
export type CreateGenerationSessionCommand = CreateGenerationSessionRequestDto;
export type DeleteProposalsCommand = DeleteProposalsRequestDto;
export type DeleteCardCommand = DeleteCardInput;

/**
 * Statistics DTOs.
 */
export type GenerationStatsDto = {
  total_generated: number;
  total_accepted: number;
  session_count: number;
};

export type GetGenerationStatsResponseDto = ApiDataResponse<GenerationStatsDto>;
export type GetGenerationStatsResult = {
  totalGenerated: number;
  totalAccepted: number;
  sessionCount: number;
};

/**
 * Health DTOs.
 */
export type HealthDto = {
  status: "ok";
};

/**
 * Health endpoint is intentionally unwrapped and returns `{ status: "ok" }`.
 */
export type GetHealthResponseDto = HealthDto;
