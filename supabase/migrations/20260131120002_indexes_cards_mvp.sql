-- ---------------------------------------------------------------------------
-- Migration: Indexes cards MVP
-- Purpose: Indexes for RLS, filtering and sorted lists.
-- Depends on: 20260131120001_tables_cards_mvp.sql
-- Affected: public.cards, public.generation_sessions, public.card_proposals
-- ---------------------------------------------------------------------------

create index cards_user_id_idx on public.cards (user_id);
comment on index cards_user_id_idx is 'Filter cards by user; used by RLS and app.';

create index cards_user_id_created_at_idx on public.cards (user_id, created_at desc);
comment on index cards_user_id_created_at_idx is 'List "My cards" sorted by date.';

create index generation_sessions_user_id_idx on public.generation_sessions (user_id);
comment on index generation_sessions_user_id_idx is 'List sessions and stats by user; RLS.';

create index card_proposals_session_id_idx on public.card_proposals (session_id);
comment on index card_proposals_session_id_idx is 'Fetch proposals by session; CASCADE/join.';
