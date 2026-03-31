import type { SupabaseClient } from "@/db/supabase.client";
import type {
  CardProposalDto,
  GenerationSessionDto,
  GetGenerationSessionByIdInput,
  GetGenerationSessionByIdResult,
  GenerationSessionWithProposalsDto,
  ListGenerationSessionsCommand,
  ListGenerationSessionsResult,
} from "@/types";

interface GetGenerationSessionByIdDeps {
  supabase: SupabaseClient;
}

const toSessionDto = (row: {
  id: string;
  input_length: number;
  generated_count: number;
  accepted_count: number;
  created_at: string;
}): GenerationSessionDto => ({
  id: row.id,
  input_length: row.input_length,
  generated_count: row.generated_count,
  accepted_count: row.accepted_count,
  created_at: row.created_at,
});

export type ListUserSessionsResult =
  | { kind: "ok"; data: ListGenerationSessionsResult }
  | { kind: "error"; error: Error };

/**
 * Paginated list of generation sessions for the user (explicit `user_id` filter + RLS).
 */
export const listUserSessions = async (
  deps: GetGenerationSessionByIdDeps,
  command: ListGenerationSessionsCommand
): Promise<ListUserSessionsResult> => {
  const { supabase } = deps;
  const { userId, page, limit, sort } = command;

  const { count: totalCount, error: countError } = await supabase
    .from("generation_sessions")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId);

  if (countError) {
    return { kind: "error", error: new Error(countError.message) };
  }

  const total = totalCount ?? 0;
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let query = supabase
    .from("generation_sessions")
    .select("id, input_length, generated_count, accepted_count, created_at")
    .eq("user_id", userId);

  if (sort === "created_at_desc") {
    query = query.order("created_at", { ascending: false }).order("id", { ascending: false });
  } else {
    query = query.order("created_at", { ascending: true }).order("id", { ascending: true });
  }

  const { data: rows, error } = await query.range(from, to);

  if (error) {
    return { kind: "error", error: new Error(error.message) };
  }

  const list = rows ?? [];
  const items = list.map((row) => toSessionDto(row));
  const hasMore = from + items.length < total;

  return {
    kind: "ok",
    data: {
      items,
      total,
      hasMore,
    },
  };
};

/**
 * Loads a single generation session and its proposals for the given user.
 * RLS + explicit `user_id` filter; missing or inaccessible session → `not_found`.
 */
export const getGenerationSessionById = async (
  deps: GetGenerationSessionByIdDeps,
  input: GetGenerationSessionByIdInput
): Promise<GetGenerationSessionByIdResult> => {
  const { supabase } = deps;
  const { sessionId, userId } = input;

  const { data: sessionRow, error: sessionError } = await supabase
    .from("generation_sessions")
    .select("id, input_length, generated_count, accepted_count, created_at")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .maybeSingle();

  if (sessionError) {
    return { kind: "error", error: new Error(sessionError.message) };
  }

  if (!sessionRow) {
    return { kind: "not_found" };
  }

  const { data: proposalRows, error: proposalsError } = await supabase
    .from("card_proposals")
    .select("id, session_id, front, back, position, created_at")
    .eq("session_id", sessionId)
    .order("position", { ascending: true });

  if (proposalsError) {
    return { kind: "error", error: new Error(proposalsError.message) };
  }

  const session = toSessionDto(sessionRow);
  const proposals = (proposalRows ?? []) as CardProposalDto[];

  const data: GenerationSessionWithProposalsDto = {
    session,
    proposals,
  };

  return { kind: "found", data };
};
