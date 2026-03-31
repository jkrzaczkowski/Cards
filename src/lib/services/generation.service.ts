import type { SupabaseClient } from "@/db/supabase.client";
import type {
  CardProposalDto,
  CreateGenerationSessionInput,
  GenerationSessionDto,
  GenerationSessionWithProposalsDto,
} from "@/types";

const MAX_PROPOSALS = 50;

type CreateGenerationSessionDeps = {
  supabase: SupabaseClient;
};

export type CreateGenerationSessionServiceInput = CreateGenerationSessionInput & {
  userId: string;
};

export type CreateGenerationSessionResult =
  | { kind: "success"; data: GenerationSessionWithProposalsDto }
  | { kind: "no_proposals" }
  | { kind: "error"; error: Error };

/**
 * Placeholder for future AI integration. Returns deterministic sample proposals.
 */
const generateStubCardProposals = (
  inputText: string,
  maxProposals: number,
): Array<{ front: string; back: string }> => {
  const max = Math.max(1, Math.min(maxProposals, MAX_PROPOSALS));
  const normalizedInput = inputText.trim();

  const drafts = [
    {
      front: `Co jest glownym tematem tekstu: "${normalizedInput.slice(0, 48)}..."?`,
      back: "To przykladowa odpowiedz zwrocona przez stub serwisu generowania.",
    },
    {
      front: "Jakie sa 2-3 najwazniejsze fakty z podanego materialu?",
      back: "To przykladowa fiszka. Docelowo tresc bedzie generowana przez model AI.",
    },
    {
      front: "Jak wlasnymi slowami podsumowac ten material?",
      back: "Krotkie podsumowanie zagadnienia na podstawie inputu uzytkownika.",
    },
  ].slice(0, max);

  return drafts.filter((p) => p.front.trim().length > 0 && p.back.trim().length > 0);
};

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

export const createGenerationSession = async (
  deps: CreateGenerationSessionDeps,
  input: CreateGenerationSessionServiceInput,
): Promise<CreateGenerationSessionResult> => {
  const { supabase } = deps;
  const { inputText, userId } = input;

  const proposalsDraft = generateStubCardProposals(inputText, MAX_PROPOSALS);
  if (proposalsDraft.length === 0) {
    return { kind: "no_proposals" };
  }

  const inputLength = inputText.trim().length;

  const { data: sessionRow, error: sessionError } = await supabase
    .from("generation_sessions")
    .insert({
      user_id: userId,
      input_length: inputLength,
      generated_count: proposalsDraft.length,
      accepted_count: 0,
    })
    .select("id, input_length, generated_count, accepted_count, created_at")
    .single();

  if (sessionError || !sessionRow) {
    return {
      kind: "error",
      error: new Error(sessionError?.message ?? "Failed to insert generation session."),
    };
  }

  const proposalRows = proposalsDraft.map((p, index) => ({
    session_id: sessionRow.id,
    front: p.front,
    back: p.back,
    position: index,
  }));

  const { data: insertedProposals, error: proposalsError } = await supabase
    .from("card_proposals")
    .insert(proposalRows)
    .select("id, session_id, front, back, position, created_at");

  if (proposalsError || !insertedProposals) {
    await supabase.from("generation_sessions").delete().eq("id", sessionRow.id);

    return {
      kind: "error",
      error: new Error(proposalsError?.message ?? "Failed to insert card proposals."),
    };
  }

  const session = toSessionDto(sessionRow);
  const proposals = insertedProposals as CardProposalDto[];

  const data: GenerationSessionWithProposalsDto = {
    session,
    proposals,
  };

  return { kind: "success", data };
};
