-- ---------------------------------------------------------------------------
-- Migration: RPC create_cards_bulk (atomic insert + accepted_count)
-- Purpose: Single transaction for POST /api/v1/cards bulk create (plan §10).
-- Depends on: 20260131120003_rls_cards_mvp.sql
-- ---------------------------------------------------------------------------

create or replace function public.create_cards_bulk(p_user_id uuid, p_cards jsonb)
returns table (
  id uuid,
  front text,
  back text,
  source text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_len int;
  rec record;
  v_ord int;
  v_front text;
  v_back text;
  v_pid uuid;
  v_need int;
  v_have int;
begin
  if p_user_id is null then
    raise exception 'USER_ID_REQUIRED';
  end if;

  if p_cards is null or jsonb_typeof(p_cards) != 'array' then
    raise exception 'INVALID_PAYLOAD';
  end if;

  v_len := jsonb_array_length(p_cards);
  if v_len < 1 or v_len > 50 then
    raise exception 'INVALID_CARD_COUNT';
  end if;

  drop table if exists _ccb_batch;
  create temp table _ccb_batch (
    ord int primary key,
    front text not null,
    back text not null,
    proposal_id uuid
  ) on commit drop;

  for rec in
    select *
    from jsonb_array_elements(p_cards) with ordinality as t(elem, ordinality)
  loop
    v_ord := rec.ordinality::int;
    v_front := trim(both from coalesce(rec.elem->>'front', ''));
    v_back := trim(both from coalesce(rec.elem->>'back', ''));

    if length(v_front) < 1 or length(v_front) > 200 or length(v_back) < 1 or length(v_back) > 500 then
      raise exception 'INVALID_CARD_FIELDS';
    end if;

    if rec.elem->'proposal_id' is null
      or jsonb_typeof(rec.elem->'proposal_id') = 'null'
      or coalesce(rec.elem->>'proposal_id', '') = ''
    then
      v_pid := null;
    else
      begin
        v_pid := (rec.elem->>'proposal_id')::uuid;
      exception
        when invalid_text_representation then
          raise exception 'INVALID_PROPOSAL_UUID';
      end;
    end if;

    insert into _ccb_batch (ord, front, back, proposal_id) values (v_ord, v_front, v_back, v_pid);
  end loop;

  if (select count(*)::int from _ccb_batch) != v_len then
    raise exception 'INVALID_PAYLOAD';
  end if;

  select count(distinct proposal_id)::int into v_need from _ccb_batch where proposal_id is not null;

  if v_need > 0 then
    select count(distinct cp.id)::int into v_have
    from public.card_proposals cp
    inner join public.generation_sessions gs on gs.id = cp.session_id and gs.user_id = p_user_id
    where cp.id in (select proposal_id from _ccb_batch where proposal_id is not null);

    if v_need != coalesce(v_have, 0) then
      raise exception 'PROPOSALS_INVALID';
    end if;
  end if;

  return query
  insert into public.cards (user_id, front, back, source)
  select
    p_user_id,
    b.front,
    b.back,
    case when b.proposal_id is null then 'manual' else 'ai_generated' end
  from _ccb_batch b
  order by b.ord
  returning public.cards.id, public.cards.front, public.cards.back, public.cards.source, public.cards.created_at, public.cards.updated_at;

  update public.generation_sessions gs
  set accepted_count = accepted_count + agg.cnt
  from (
    select cp.session_id, count(*)::int as cnt
    from _ccb_batch b
    inner join public.card_proposals cp on cp.id = b.proposal_id
    where b.proposal_id is not null
    group by cp.session_id
  ) agg
  where gs.id = agg.session_id and gs.user_id = p_user_id;
end;
$$;

comment on function public.create_cards_bulk(uuid, jsonb) is
  'Atomically inserts cards and updates generation_sessions.accepted_count for AI-linked rows.';

revoke all on function public.create_cards_bulk(uuid, jsonb) from public;
grant execute on function public.create_cards_bulk(uuid, jsonb) to anon, authenticated, service_role;
