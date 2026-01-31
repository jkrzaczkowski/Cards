-- ---------------------------------------------------------------------------
-- Migration: Trigger cleanup on auth.users delete
-- Purpose: SECURITY DEFINER function + trigger to remove user data from
--   cards and generation_sessions (card_proposals removed by FK CASCADE).
-- Depends on: 20260131120003_rls_cards_mvp.sql
-- Affected: public.cleanup_user_data_on_delete(), auth.users trigger
-- Special: Trigger on auth.users requires migration runner to have rights on
--   the auth schema (e.g. Supabase self-hosted / CI).
-- ---------------------------------------------------------------------------

create or replace function public.cleanup_user_data_on_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- delete sessions first so FK CASCADE removes card_proposals; then cards (no dependents)
  delete from public.generation_sessions where user_id = old.id;
  delete from public.cards where user_id = old.id;
  return old;
end;
$$;

comment on function public.cleanup_user_data_on_delete() is
  'After auth.users delete: removes user rows from cards and generation_sessions (card_proposals cascade).';

-- WARNING: Creating a trigger on auth.users requires privileges on the auth schema.
-- If this fails in your environment, run it manually with a role that has
-- permission to create triggers on auth.users (e.g. postgres or supabase_admin).
create trigger on_auth_user_deleted_cleanup
  after delete on auth.users
  for each row
  execute function public.cleanup_user_data_on_delete();
