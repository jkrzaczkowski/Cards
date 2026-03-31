import { z } from "zod";

import type { SupabaseClient } from "@/db/supabase.client";
import type {
  CardDto,
  CreateCardsForUserResult,
  CreateCardsInput,
  CreateCardsRpcItemPayload,
  DeleteCardInput,
  GetCardByIdInput,
  GetCardByIdResult,
  ListCardsCommand,
  ListCardsResult,
  UpdateCardByIdInput,
  UpdateCardByIdResult,
} from "@/types";

type DeleteCardResult = { kind: "deleted" } | { kind: "not_found" } | { kind: "error"; error: Error };

interface DeleteCardDeps {
  supabase: SupabaseClient;
}

export const deleteCard = async (deps: DeleteCardDeps, input: DeleteCardInput): Promise<DeleteCardResult> => {
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

export const getCardById = async (deps: DeleteCardDeps, input: GetCardByIdInput): Promise<GetCardByIdResult> => {
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

export const updateCardById = async (
  deps: DeleteCardDeps,
  input: UpdateCardByIdInput
): Promise<UpdateCardByIdResult> => {
  const { supabase } = deps;
  const { cardId, userId, patch } = input;

  const updatePayload: { front?: string; back?: string } = {};
  if (patch.front !== undefined) updatePayload.front = patch.front;
  if (patch.back !== undefined) updatePayload.back = patch.back;

  if (Object.keys(updatePayload).length === 0) {
    return { kind: "error", error: new Error("No fields to update.") };
  }

  const { data, error } = await supabase
    .from("cards")
    .update(updatePayload)
    .eq("id", cardId)
    .eq("user_id", userId)
    .select("id, front, back, source, created_at, updated_at")
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
    kind: "updated",
    data: {
      ...data,
      source: sourceParse.data,
    },
  };
};

interface Row {
  id: string;
  front: string;
  back: string;
  source: string;
  created_at: string;
  updated_at: string;
}

const mapRowsToCardDtos = (rows: Row[]): CardDto[] => {
  return rows.map((row) => {
    const sourceParse = cardSourceSchema.safeParse(row.source);
    if (!sourceParse.success) {
      throw new Error("Invalid card source value.");
    }
    return {
      id: row.id,
      front: row.front,
      back: row.back,
      source: sourceParse.data,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  });
};

const RPC_VALIDATION_MESSAGES: Record<string, string> = {
  INVALID_PROPOSAL_UUID: "proposal_id must be a valid UUID.",
  INVALID_CARD_COUNT: "cards must contain between 1 and 50 items.",
  INVALID_CARD_FIELDS: "Each card must have front (1–200) and back (1–500) characters after trim.",
  INVALID_PAYLOAD: 'Request body must be a JSON object with a valid "cards" array.',
  USER_ID_REQUIRED: "User identifier is required.",
};

function mapCreateCardsRpcFailure(error: { message: string }): CreateCardsForUserResult {
  const raw = error.message ?? "";
  if (raw.includes("PROPOSALS_INVALID")) {
    return { kind: "not_found" };
  }

  const code = (Object.keys(RPC_VALIDATION_MESSAGES) as (keyof typeof RPC_VALIDATION_MESSAGES)[]).find((c) =>
    raw.includes(c)
  );

  if (code) {
    return { kind: "bad_request", message: RPC_VALIDATION_MESSAGES[code] };
  }

  return { kind: "error", error: new Error(raw) };
}

/**
 * Bulk-create cards via `create_cards_bulk` RPC (single transaction: insert + accepted_count).
 */
export const createCardsForUser = async (
  deps: DeleteCardDeps,
  userId: string,
  input: CreateCardsInput
): Promise<CreateCardsForUserResult> => {
  const { supabase } = deps;

  const p_cards: CreateCardsRpcItemPayload[] = input.cards.map((c) => ({
    front: c.front,
    back: c.back,
    proposal_id: c.proposalId ?? null,
  }));

  const { data, error } = await supabase.rpc("create_cards_bulk", {
    p_user_id: userId,
    p_cards: p_cards,
  });

  if (error) {
    return mapCreateCardsRpcFailure(error);
  }

  const list = data ?? [];
  if (list.length !== input.cards.length) {
    return {
      kind: "error",
      error: new Error("Unexpected row count from create_cards_bulk."),
    };
  }

  try {
    const items = mapRowsToCardDtos(list as Row[]);
    return { kind: "ok", data: items };
  } catch (e) {
    return {
      kind: "error",
      error: e instanceof Error ? e : new Error("Mapping failed."),
    };
  }
};

/** PostgREST filter values; do not URL-encode here — client encodes the query string. */
const postgrestQuoted = (value: string) => `"${value.replace(/"/g, '""')}"`;

const keysetOrFilter = (
  sort: ListCardsCommand["sort"],
  cursor: { id: string; created_at: string; updated_at: string }
): string => {
  const { id, created_at, updated_at } = cursor;
  const ca = postgrestQuoted(created_at);
  const ua = postgrestQuoted(updated_at);
  /** UUIDs must be quoted; unquoted hyphens break PostgREST parsing of `id.lt.<value>`. */
  const cid = postgrestQuoted(id);

  if (sort === "created_at_desc") {
    return `and(created_at.eq.${ca},id.lt.${cid}),created_at.lt.${ca}`;
  }
  if (sort === "created_at_asc") {
    return `and(created_at.eq.${ca},id.gt.${cid}),created_at.gt.${ca}`;
  }
  return `and(updated_at.eq.${ua},id.lt.${cid}),updated_at.lt.${ua}`;
};

export type ListUserCardsResult =
  | { kind: "ok"; data: ListCardsResult }
  | { kind: "invalid_cursor" }
  | { kind: "error"; error: Error };

export const listUserCards = async (deps: DeleteCardDeps, command: ListCardsCommand): Promise<ListUserCardsResult> => {
  const { supabase } = deps;
  const { userId, limit, sort, mode, page = 1, cursor } = command;

  const { count: totalCount, error: countError } = await supabase
    .from("cards")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId);

  if (countError) {
    return { kind: "error", error: new Error(countError.message) };
  }

  const total = totalCount ?? 0;

  if (mode === "page") {
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = supabase.from("cards").select("id, front, back, source, created_at, updated_at").eq("user_id", userId);

    if (sort === "created_at_desc") {
      query = query.order("created_at", { ascending: false }).order("id", { ascending: false });
    } else if (sort === "created_at_asc") {
      query = query.order("created_at", { ascending: true }).order("id", { ascending: true });
    } else {
      query = query.order("updated_at", { ascending: false }).order("id", { ascending: false });
    }

    const { data: rows, error } = await query.range(from, to);

    if (error) {
      return { kind: "error", error: new Error(error.message) };
    }

    const list = rows ?? [];
    let items: CardDto[];
    try {
      items = mapRowsToCardDtos(list as Row[]);
    } catch (e) {
      return {
        kind: "error",
        error: e instanceof Error ? e : new Error("Mapping failed."),
      };
    }

    const hasMore = from + items.length < total;

    return {
      kind: "ok",
      data: {
        items,
        total,
        hasMore,
        page,
      },
    };
  }

  if (!cursor) {
    return { kind: "error", error: new Error("Cursor mode requires cursor.") };
  }

  const { data: cursorRow, error: cursorErr } = await supabase
    .from("cards")
    .select("id, created_at, updated_at")
    .eq("user_id", userId)
    .eq("id", cursor)
    .maybeSingle();

  if (cursorErr) {
    return { kind: "error", error: new Error(cursorErr.message) };
  }

  if (!cursorRow) {
    return { kind: "invalid_cursor" };
  }

  const orFilter = keysetOrFilter(sort, {
    id: cursorRow.id,
    created_at: cursorRow.created_at,
    updated_at: cursorRow.updated_at,
  });

  let query = supabase
    .from("cards")
    .select("id, front, back, source, created_at, updated_at")
    .eq("user_id", userId)
    .or(orFilter);

  if (sort === "created_at_desc") {
    query = query.order("created_at", { ascending: false }).order("id", { ascending: false });
  } else if (sort === "created_at_asc") {
    query = query.order("created_at", { ascending: true }).order("id", { ascending: true });
  } else {
    query = query.order("updated_at", { ascending: false }).order("id", { ascending: false });
  }

  const fetchLimit = limit + 1;
  const { data: rows, error } = await query.limit(fetchLimit);

  if (error) {
    return { kind: "error", error: new Error(error.message) };
  }

  const list = rows ?? [];
  const hasMore = list.length > limit;
  const sliced = list.slice(0, limit);

  let items: CardDto[];
  try {
    items = mapRowsToCardDtos(sliced as Row[]);
  } catch (e) {
    return {
      kind: "error",
      error: e instanceof Error ? e : new Error("Mapping failed."),
    };
  }

  return {
    kind: "ok",
    data: {
      items,
      total,
      hasMore,
      page: 1,
    },
  };
};
