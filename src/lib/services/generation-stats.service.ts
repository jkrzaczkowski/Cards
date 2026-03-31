import type { SupabaseClient } from "@/db/supabase.client";
import type { GetGenerationStatsInput, GetGenerationStatsResult } from "@/types";

interface GenerationStatsDeps {
  supabase: SupabaseClient;
}

export type GetGenerationStatsForUserResult =
  | { kind: "success"; data: GetGenerationStatsResult }
  | { kind: "error"; error: Error };

/**
 * Reads stats from `generation_sessions` for a single user (RLS + explicit `user_id` filter).
 * Supabase hosted projects often reject PostgREST aggregate selects (`col.sum()`), so we fetch
 * `generated_count` / `accepted_count` per row and sum in process.
 */
export const getGenerationStatsForUser = async (
  deps: GenerationStatsDeps,
  input: GetGenerationStatsInput
): Promise<GetGenerationStatsForUserResult> => {
  const { supabase } = deps;
  const { userId } = input;

  const { data, error } = await supabase
    .from("generation_sessions")
    .select("generated_count, accepted_count")
    .eq("user_id", userId);

  if (error) {
    return { kind: "error", error: new Error(error.message) };
  }

  const rows = data ?? [];
  let totalGenerated = 0;
  let totalAccepted = 0;
  for (const row of rows) {
    totalGenerated += toNonNegativeInt(row.generated_count);
    totalAccepted += toNonNegativeInt(row.accepted_count);
  }

  return {
    kind: "success",
    data: {
      totalGenerated,
      totalAccepted,
      sessionCount: rows.length,
    },
  };
};

function toNonNegativeInt(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.trunc(n);
}
