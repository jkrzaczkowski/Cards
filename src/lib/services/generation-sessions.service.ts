import type { SupabaseClient } from "@/db/supabase.client";
import type {
  CardProposalDto,
  GenerationSessionDto,
  GetGenerationSessionByIdInput,
  GetGenerationSessionByIdResult,
  GenerationSessionWithProposalsDto,
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
