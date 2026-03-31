import type { DeleteCardInput } from "@/types";
import type { SupabaseClient } from "@/db/supabase.client";

type DeleteCardResult =
  | { kind: "deleted" }
  | { kind: "not_found" }
  | { kind: "error"; error: Error };

type DeleteCardDeps = {
  supabase: SupabaseClient;
};

export const deleteCard = async (
  deps: DeleteCardDeps,
  input: DeleteCardInput,
): Promise<DeleteCardResult> => {
  const { supabase } = deps;
  const { cardId, userId } = input;

  const { data, error } = await supabase
    .from("cards")
    .delete()
    .eq("id", cardId)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();

  if (error) {
    return { kind: "error", error: new Error(error.message) };
  }

  if (!data?.id) {
    return { kind: "not_found" };
  }

  return { kind: "deleted" };
};
