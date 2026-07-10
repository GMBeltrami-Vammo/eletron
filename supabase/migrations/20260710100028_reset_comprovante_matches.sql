-- Comprovante reformulation (Gabriel 2026-07-10): a reversible "Resetar
-- comprovantes" action so the cold test clone can re-run the matching stress
-- test as many times as needed ("remove all comprovantes we have matched right
-- now and we will match them now with the same documents").
--
-- Unbinds EVERY comprovante-backed link and returns comprovante state to zero:
--   1. walk back charges that a comprovante drove to 'pago' (status_source='rpc'
--      AND a receipted payment) — the clone's sync/portal 'pago' rows
--      (status_source='sync', never comprovante-backed) are LEFT untouched, so
--      the parallel scraper/portal "paid" status is preserved (Gabriel: "são
--      status paralelos"; decision #29/#35).
--   2. delete every comprovante-backed payment (receipt_id not null, any source).
--   3. delete the isolated per-page PDFs' index rows (document_pages), all
--      parsed receipts, and the comprovante `documents` rows.
-- The Supabase Storage bucket (comprovante_pages) and the Drive whole-PDF files
-- are purged by the calling server action (SQL can't reach Storage/Drive).
-- is_vammo_user() gate (roles suspended, decision #26); one audit row.

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

  -- 1. walk comprovante-driven 'pago' charges back to open (BEFORE deleting the
  --    payments the EXISTS check reads). sync/portal pago is preserved.
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
  with del_pg as (delete from charging.document_pages returning document_id)
  select count(*) into v_pages from del_pg;

  with del_rc as (delete from charging.receipts returning id)
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
