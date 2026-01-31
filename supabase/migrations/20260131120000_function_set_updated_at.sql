-- ---------------------------------------------------------------------------
-- Migration: Function set_updated_at
-- Purpose: Helper for cards.updated_at trigger. Used by next migration.
-- Affected: public.set_updated_at()
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Trigger function: sets updated_at to now() on UPDATE. Used by cards.updated_at.';
