-- Fix: "Resetar comprovantes" failed with "DELETE requires a WHERE clause".
-- reset_comprovante_matches (migration 28) had two unqualified DELETEs
-- (document_pages, receipts). Migrations run as a privileged role so they
-- applied fine, but the app calls this RPC as the `authenticated` role, where
-- supautils' safe-update guard blocks any DELETE without a WHERE. The clause is
-- always-true (both PKs are NOT NULL) so it still deletes every row — it just
-- satisfies the guard. All other statements already had a WHERE.
create or replace function charging.reset_comprovante_matches()
returns jsonb
language plpgsql
security definer
set search_path to 'charging'
as $$
declare
  v_email    text := charging.jwt_email();
  v_charges  integer;
  v_payments integer;
  v_pages    integer;
  v_receipts integer;
  v_docs     integer;
begin
  if not charging.is_vammo_user() then raise exception 'não autorizado'; end if;

  -- 1. walk comprovante-driven 'pago' charges back to open (sync/portal preserved).
  with reset_charges as (
    update charging.charges c
    set status = (case when c.due_date is not null and c.due_date < current_date
                       then 'atrasado' else 'pendente' end)::charging.charge_status,
        status_source = 'rpc'
    where c.status = 'pago'
      and c.status_source = 'rpc'
      and exists (select 1 from charging.payments p
                  where p.charge_id = c.id and p.receipt_id is not null)
    returning c.id
  )
  select count(*) into v_charges from reset_charges;

  -- 2. delete every comprovante-backed payment.
  with del_pay as (
    delete from charging.payments where receipt_id is not null returning id
  )
  select count(*) into v_payments from del_pay;

  -- 3. isolated pages → receipts → comprovante documents (FK-safe order).
  --    The always-true WHERE clauses are REQUIRED: the app calls this as the
  --    `authenticated` role, where supautils blocks an unqualified DELETE.
  with del_pg as (
    delete from charging.document_pages where document_id is not null returning document_id
  )
  select count(*) into v_pages from del_pg;

  with del_rc as (delete from charging.receipts where id is not null returning id)
  select count(*) into v_receipts from del_rc;

  with del_doc as (
    delete from charging.documents where kind = 'comprovante' returning id
  )
  select count(*) into v_docs from del_doc;

  insert into charging.audit_events (entity_table, entity_id, event_type, actor_email, detail)
  values ('documents', 'reset', 'comprovante_reset', v_email,
    jsonb_build_object('charges_reset', v_charges, 'payments_deleted', v_payments,
      'pages_deleted', v_pages, 'receipts_deleted', v_receipts,
      'documents_deleted', v_docs));

  return jsonb_build_object('charges_reset', v_charges, 'payments_deleted', v_payments,
    'pages_deleted', v_pages, 'receipts_deleted', v_receipts,
    'documents_deleted', v_docs);
end;
$$;

revoke execute on function charging.reset_comprovante_matches() from public, anon;
grant  execute on function charging.reset_comprovante_matches() to authenticated;
