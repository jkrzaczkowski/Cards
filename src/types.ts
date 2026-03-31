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

export type PaginationMetaDto = {
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
 * Card DTOs and Commands.
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

export type ListCardsResponseDto = PaginatedResponseDto<CardDto>;

/**
 * API request DTOs keep snake_case to match JSON contracts.
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

export type UpdateCardCommand = Partial<Pick<CardUpdateEntity, "front" | "back">>;

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

export type CreateGenerationSessionResponseDto =
  ApiDataResponse<GenerationSessionWithProposalsDto>;

export type ListGenerationSessionsQueryDto = {
  page?: number;
  limit?: number;
  sort?: "created_at_desc" | "created_at_asc";
};

export type ListGenerationSessionsResponseDto =
  PaginatedResponseDto<GenerationSessionDto>;

export type GetGenerationSessionResponseDto =
  ApiDataResponse<GenerationSessionWithProposalsDto>;

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

/**
 * Backward-compatible aliases for previous naming.
 * Prefer *RequestDto for API and *Input for internal services.
 */
export type CreateCardItemCommand = CreateCardItemRequestDto;
export type CreateCardsCommand = CreateCardsRequestDto;
export type CreateGenerationSessionCommand = CreateGenerationSessionRequestDto;
export type DeleteProposalsCommand = DeleteProposalsRequestDto;

/**
 * Statistics DTOs.
 */
export type GenerationStatsDto = {
  total_generated: number;
  total_accepted: number;
  session_count: number;
};

export type GetGenerationStatsResponseDto = ApiDataResponse<GenerationStatsDto>;

/**
 * Health DTOs.
 */
export type HealthDto = {
  status: "ok";
};
