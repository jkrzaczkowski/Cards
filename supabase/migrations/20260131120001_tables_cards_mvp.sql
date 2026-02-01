-- ---------------------------------------------------------------------------
-- Migration: Tables cards MVP
-- Purpose: Create generation_sessions, cards, card_proposals; trigger on cards.
-- Depends on: 20260131120000_function_set_updated_at.sql
-- Affected: public.generation_sessions, public.cards, public.card_proposals
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Table: generation_sessions
-- One row per LLM response session; holds input_length, generated_count,
-- accepted_count. user_id references auth.users; CASCADE deletes on user delete.
-- ---------------------------------------------------------------------------
create table public.generation_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  input_length integer not null,
  generated_count integer not null,
  accepted_count integer not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.generation_sessions is
  'One row per generation session (after LLM response). Metrics: input length, generated and accepted counts.';
comment on column public.generation_sessions.user_id is
  'FK to auth.users(id). Rows deleted on user delete (CASCADE).';
comment on column public.generation_sessions.input_length is
  'Length of input text in characters.';
comment on column public.generation_sessions.generated_count is
  'Number of proposals in this session (e.g. rows in card_proposals).';
comment on column public.generation_sessions.accepted_count is
  'Number of cards from this session saved to cards; updated on save.';

-- ---------------------------------------------------------------------------
-- Table: cards
-- User-approved flashcards (manual or ai_generated). Only id (UUID) exposed
-- to client. updated_at maintained by trigger.
-- ---------------------------------------------------------------------------
create table public.cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  front text not null check (char_length(front) <= 200),
  back text not null check (char_length(back) <= 500),
  source text not null check (source in ('manual', 'ai_generated')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.cards is
  'User-approved flashcards. Single client-facing id (UUID).';
comment on column public.cards.user_id is
  'FK to auth.users(id). Rows deleted on user delete (CASCADE).';
comment on column public.cards.source is
  'Set on insert only; no default. Values: manual, ai_generated.';

-- Trigger: keep cards.updated_at in sync on update
create trigger cards_set_updated_at
  before update on public.cards
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Table: card_proposals
-- Proposals before approval; tied to generation_sessions. On approval, data
-- goes to cards; proposals are removed or unused (no generation_session_id
-- on cards in MVP). CASCADE deletes when session is deleted.
-- ---------------------------------------------------------------------------
create table public.card_proposals (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.generation_sessions(id) on delete cascade,
  front text not null,
  back text not null,
  position integer not null,
  created_at timestamptz not null default now(),
  unique (session_id, position)
);

comment on table public.card_proposals is
  'Proposals before approval; linked to generation_sessions. Deleted or unused after save to cards.';
comment on column public.card_proposals.session_id is
  'FK to generation_sessions; CASCADE delete.';
comment on column public.card_proposals.position is
  'Order within session. Unique per (session_id, position).';
