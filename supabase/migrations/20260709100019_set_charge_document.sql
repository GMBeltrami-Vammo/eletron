-- Feature D, Part 2b: set_charge_document — the sole app-exposed writer for
-- charges.source_document_id (the charge's SOURCE bill: boleto/fatura/nota).
-- Until now the column was written only at creation by create_manual_bill and
-- the cobrança webhook; this lets a human COMPLETE the webhook by hand when a
-- document lands incomplete or unlinked (Gabriel, 2026-07-09), and correct a
-- wrong binding. Distinct from the payment-proof "Comprovante"
-- (payment→receipt→document) — those never touch source_document_id.
--
-- Modeled on set_station_hidden (migration 18): SECURITY DEFINER, pinned
-- search_path, is_vammo_user() gate (roles suspended — decision #26),
-- idempotent no-op, exactly one audit row. p_document_id = null clears it.
--
-- Does NOT refuse on a 'pago' charge: source_document_id is source-bill
-- metadata, independent of the payment→receipt→document chain that decision #29
-- governs; attaching/correcting the original bill after payment is legitimate
-- and touches neither status nor payments. (reclassify_charge refuses pago
-- because it rewrites attribution/amount/lines — a different blast radius.)

create or replace function charging.set_charge_document(p_charge_id uuid, p_document_id uuid)
returns void
language plpgsql
security definer
set search_path to 'charging'
as $$
declare
  v_email  text := charging.jwt_email();
  v_charge charging.charges%rowtype;
  v_kind   charging.document_kind;
begin
  if not charging.is_vammo_user() then raise exception 'não autorizado'; end if;

  select * into v_charge from charging.charges where id = p_charge_id for update;
  if not found then raise exception 'cobrança % não encontrada', p_charge_id; end if;

  -- When binding (not clearing), the document must exist and be a SOURCE BILL —
  -- never a payment proof / meter photo / contract (keeps "Documento de origem"
  -- and "Comprovante" from being conflated). Friendly message before the FK.
  if p_document_id is not null then
    select kind into v_kind from charging.documents where id = p_document_id;
    if not found then raise exception 'documento % não encontrado', p_document_id; end if;
    if v_kind in ('comprovante', 'foto_medidor', 'contrato') then
      raise exception 'documento não é uma fatura/boleto de origem (tipo: %)', v_kind;
    end if;
  end if;

  if v_charge.source_document_id is not distinct from p_document_id then
    return;  -- idempotent no-op (double-submit / re-bind the same doc)
  end if;

  update charging.charges
  set source_document_id = p_document_id, updated_at = now()
  where id = p_charge_id;

  insert into charging.audit_events (entity_table, entity_id, event_type, actor_email, detail)
  values ('charges', p_charge_id::text,
    case when p_document_id is null then 'document_unlinked' else 'document_linked' end,
    v_email,
    jsonb_build_object('previous_document_id', v_charge.source_document_id, 'document_id', p_document_id));
end;
$$;

revoke execute on function charging.set_charge_document(uuid, uuid) from public, anon;
grant  execute on function charging.set_charge_document(uuid, uuid) to authenticated;
