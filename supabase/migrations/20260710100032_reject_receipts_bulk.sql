-- Eletron test-env — migration 32: reject_receipts (bulk).
-- Backs the review-queue "Descartar não relacionados em lote" control: with a
-- 200+-entry comprovante, most parsed receipts are unrelated to our charges and
-- match nothing (candidateIds empty). This lets an operator reject all of them
-- in one click instead of one-by-one. Same guards + audit as the singular
-- reject_receipt (migration 7); set-based so it stays fast at scale. Receipts
-- that don't qualify (already resolved, or with payments allocated) are skipped,
-- not errored — the return value is how many were actually rejected.
create or replace function charging.reject_receipts(p_receipt_ids uuid[], p_reason text)
returns integer
language plpgsql
security definer
set search_path to 'charging'
as $$
declare
  v_email text := charging.jwt_email();
  v_ids   uuid[];
begin
  if not charging.is_vammo_user() then raise exception 'not authorized'; end if;
  if not charging.is_operator() then raise exception 'operator role required'; end if;

  -- Eligible = unmatched/needs-review, not already rejected, no payments allocated.
  with eligible as (
    select r.id
    from charging.receipts r
    where r.id = any(p_receipt_ids)
      and r.match_status in ('unmatched', 'needs_review')
      and not exists (
        select 1 from charging.payments p where p.receipt_id = r.id
      )
    for update
  ),
  upd as (
    update charging.receipts r
    set match_status = 'rejected',
        match_notes = coalesce(nullif(btrim(p_reason), ''), r.match_notes),
        matched_by_email = v_email,
        matched_at = now()
    from eligible e
    where r.id = e.id
    returning r.id
  )
  select array_agg(id) into v_ids from upd;

  -- One audit row per rejected receipt (parity with reject_receipt).
  insert into charging.audit_events (entity_table, entity_id, event_type, actor_email, detail)
  select 'receipts', id::text, 'rejected', v_email,
         jsonb_build_object('reason', p_reason, 'bulk', true)
  from unnest(coalesce(v_ids, '{}'::uuid[])) as id;

  return coalesce(array_length(v_ids, 1), 0);
end;
$$;

revoke execute on function charging.reject_receipts(uuid[], text) from public, anon;
grant execute on function charging.reject_receipts(uuid[], text) to authenticated;
