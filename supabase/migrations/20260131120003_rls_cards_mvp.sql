-- ---------------------------------------------------------------------------
-- Migration: RLS policies cards MVP
-- Purpose: Enable RLS and granular policies (anon + authenticated per operation).
-- Depends on: 20260131120002_indexes_cards_mvp.sql
-- Affected: public.cards, public.generation_sessions, public.card_proposals
-- ---------------------------------------------------------------------------

alter table public.cards enable row level security;
alter table public.generation_sessions enable row level security;
alter table public.card_proposals enable row level security;

-- ----- cards: anon (no access) -----
create policy cards_anon_select on public.cards
  for select to anon using (false);
comment on policy cards_anon_select on public.cards is
  'anon has no access to user cards.';

create policy cards_anon_insert on public.cards
  for insert to anon with check (false);
comment on policy cards_anon_insert on public.cards is
  'anon cannot insert cards.';

create policy cards_anon_update on public.cards
  for update to anon using (false) with check (false);
comment on policy cards_anon_update on public.cards is
  'anon cannot update cards.';

create policy cards_anon_delete on public.cards
  for delete to anon using (false);
comment on policy cards_anon_delete on public.cards is
  'anon cannot delete cards.';

-- ----- cards: authenticated (own rows only) -----
create policy cards_authenticated_select on public.cards
  for select to authenticated using (user_id = auth.uid());
comment on policy cards_authenticated_select on public.cards is
  'Users can select only their own cards.';

create policy cards_authenticated_insert on public.cards
  for insert to authenticated with check (user_id = auth.uid());
comment on policy cards_authenticated_insert on public.cards is
  'Users can insert cards only for themselves.';

create policy cards_authenticated_update on public.cards
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
comment on policy cards_authenticated_update on public.cards is
  'Users can update only their own cards.';

create policy cards_authenticated_delete on public.cards
  for delete to authenticated using (user_id = auth.uid());
comment on policy cards_authenticated_delete on public.cards is
  'Users can delete only their own cards.';

-- ----- generation_sessions: anon (no access) -----
create policy generation_sessions_anon_select on public.generation_sessions
  for select to anon using (false);
create policy generation_sessions_anon_insert on public.generation_sessions
  for insert to anon with check (false);
create policy generation_sessions_anon_update on public.generation_sessions
  for update to anon using (false) with check (false);
create policy generation_sessions_anon_delete on public.generation_sessions
  for delete to anon using (false);

comment on policy generation_sessions_anon_select on public.generation_sessions is
  'anon has no access to sessions.';
comment on policy generation_sessions_anon_insert on public.generation_sessions is
  'anon cannot insert sessions.';
comment on policy generation_sessions_anon_update on public.generation_sessions is
  'anon cannot update sessions.';
comment on policy generation_sessions_anon_delete on public.generation_sessions is
  'anon cannot delete sessions.';

-- ----- generation_sessions: authenticated (own rows only) -----
create policy generation_sessions_authenticated_select on public.generation_sessions
  for select to authenticated using (user_id = auth.uid());
create policy generation_sessions_authenticated_insert on public.generation_sessions
  for insert to authenticated with check (user_id = auth.uid());
create policy generation_sessions_authenticated_update on public.generation_sessions
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy generation_sessions_authenticated_delete on public.generation_sessions
  for delete to authenticated using (user_id = auth.uid());

comment on policy generation_sessions_authenticated_select on public.generation_sessions is
  'Users can select only their own sessions.';
comment on policy generation_sessions_authenticated_insert on public.generation_sessions is
  'Users can insert sessions only for themselves.';
comment on policy generation_sessions_authenticated_update on public.generation_sessions is
  'Users can update only their own sessions.';
comment on policy generation_sessions_authenticated_delete on public.generation_sessions is
  'Users can delete only their own sessions.';

-- ----- card_proposals: anon (no access) -----
create policy card_proposals_anon_select on public.card_proposals
  for select to anon using (false);
create policy card_proposals_anon_insert on public.card_proposals
  for insert to anon with check (false);
create policy card_proposals_anon_update on public.card_proposals
  for update to anon using (false) with check (false);
create policy card_proposals_anon_delete on public.card_proposals
  for delete to anon using (false);

comment on policy card_proposals_anon_select on public.card_proposals is
  'anon has no access to proposals.';
comment on policy card_proposals_anon_insert on public.card_proposals is
  'anon cannot insert proposals.';
comment on policy card_proposals_anon_update on public.card_proposals is
  'anon cannot update proposals.';
comment on policy card_proposals_anon_delete on public.card_proposals is
  'anon cannot delete proposals.';

-- ----- card_proposals: authenticated (only for own sessions) -----
-- Access via EXISTS on generation_sessions; no user_id on card_proposals.
create policy card_proposals_authenticated_select on public.card_proposals
  for select to authenticated
  using (
    exists (
      select 1 from public.generation_sessions gs
      where gs.id = card_proposals.session_id and gs.user_id = auth.uid()
    )
  );
create policy card_proposals_authenticated_insert on public.card_proposals
  for insert to authenticated
  with check (
    exists (
      select 1 from public.generation_sessions gs
      where gs.id = card_proposals.session_id and gs.user_id = auth.uid()
    )
  );
create policy card_proposals_authenticated_update on public.card_proposals
  for update to authenticated
  using (
    exists (
      select 1 from public.generation_sessions gs
      where gs.id = card_proposals.session_id and gs.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.generation_sessions gs
      where gs.id = card_proposals.session_id and gs.user_id = auth.uid()
    )
  );
create policy card_proposals_authenticated_delete on public.card_proposals
  for delete to authenticated
  using (
    exists (
      select 1 from public.generation_sessions gs
      where gs.id = card_proposals.session_id and gs.user_id = auth.uid()
    )
  );

comment on policy card_proposals_authenticated_select on public.card_proposals is
  'Users can select proposals only for their own sessions.';
comment on policy card_proposals_authenticated_insert on public.card_proposals is
  'Users can insert proposals only into their own sessions.';
comment on policy card_proposals_authenticated_update on public.card_proposals is
  'Users can update proposals only in their own sessions.';
comment on policy card_proposals_authenticated_delete on public.card_proposals is
  'Users can delete proposals only from their own sessions.';
