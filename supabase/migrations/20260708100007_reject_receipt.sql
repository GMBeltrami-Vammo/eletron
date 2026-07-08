-- Eletron Phase 2 — migration 7: reject_receipt RPC.
-- Backs the review-queue "Não é comprovante" control: an operator marks an
-- unmatched/needs-review receipt as rejected (it will no longer surface as a
-- pending item). Guarded like every other write RPC; refuses if the receipt
-- already has payments allocated.
create or replace function charging.reject_receipt(p_receipt_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path to 'charging'
as $$
declare
  v_email text := charging.jwt_email();
  v_r     charging.receipts%rowtype;
begin
  if not charging.is_vammo_user() then raise exception 'not authorized'; end if;
  if not charging.is_operator() then raise exception 'operator role required'; end if;

  select * into v_r from charging.receipts where id = p_receipt_id for update;
  if not found then raise exception 'receipt % not found', p_receipt_id; end if;
  if v_r.match_status = 'rejected' then
    raise exception 'receipt is already rejected';
  end if;
  if v_r.match_status not in ('unmatched','needs_review') then
    raise exception 'only unmatched/needs-review receipts can be rejected (current: %)', v_r.match_status;
  end if;
  if exists (select 1 from charging.payments where receipt_id = p_receipt_id) then
    raise exception 'receipt has payments allocated — remove them first';
  end if;

  update charging.receipts
  set match_status = 'rejected',
      match_notes = coalesce(nullif(btrim(p_reason), ''), match_notes),
      matched_by_email = v_email, matched_at = now()
  where id = p_receipt_id;

  insert into charging.audit_events (entity_table, entity_id, event_type, actor_email, detail)
  values ('receipts', p_receipt_id::text, 'rejected', v_email, jsonb_build_object('reason', p_reason));
end;
$$;

revoke execute on function charging.reject_receipt(uuid, text) from public, anon;
grant execute on function charging.reject_receipt(uuid, text) to authenticated;
