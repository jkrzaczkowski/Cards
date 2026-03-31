import { z } from "zod";

import type { DeleteCardInput, GetCardByIdInput, GetCardByIdResult } from "@/types";
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

const cardSourceSchema = z.enum(["manual", "ai_generated"]);

export const getCardById = async (
  deps: DeleteCardDeps,
  input: GetCardByIdInput,
): Promise<GetCardByIdResult> => {
  const { supabase } = deps;
  const { cardId, userId } = input;

  const { data, error } = await supabase
    .from("cards")
    .select("id, front, back, source, created_at, updated_at")
    .eq("id", cardId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    return { kind: "error", error: new Error(error.message) };
  }

  if (!data) {
    return { kind: "not_found" };
  }

  const sourceParse = cardSourceSchema.safeParse(data.source);
  if (!sourceParse.success) {
    return {
      kind: "error",
      error: new Error("Invalid card source value."),
    };
  }

  return {
    kind: "found",
    data: {
      ...data,
      source: sourceParse.data,
    },
  };
};
