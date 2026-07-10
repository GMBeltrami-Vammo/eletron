-- Feature A (Gabriel 2026-07-10): "Nova cobrança manual" — create a single
-- rent OR energy charge by hand (manual station + payment method) to fix minor
-- issues. Station-only: no contract/counterparty required (the schema's CHECK
-- constraints forbid a rent account without a contract and a third_party
-- account without a counterparty), so a manual charge carries station_id
-- directly with billing_account_id = NULL and match_status='manually_matched'
-- (so it does NOT surface in the unmatched-charges review queue, which filters
-- on unmatched/needs_review). It can later be reclassified/attributed or have a
-- document bound via the existing per-row edit actions.

create or replace function charging.create_manual_charge(
  p_kind           charging.charge_kind,
  p_station_id     integer,
  p_competencia    date,
  p_amount         numeric,
  p_due_date       date,
  p_payment_method charging.payment_method,
  p_document_id    uuid,
  p_notes          text
) returns uuid
language plpgsql
security definer
set search_path to 'charging'
as $$
declare
  v_email    text := charging.jwt_email();
  v_month    date := date_trunc('month', p_competencia)::date;
  v_dedupe   text;
  v_doc_kind charging.document_kind;
  v_charge_id uuid;
begin
  if not charging.is_vammo_user() then raise exception 'não autorizado'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'informe um valor maior que zero'; end if;
  if p_station_id is null then raise exception 'informe a estação'; end if;
  if not exists (select 1 from charging.stations where id = p_station_id) then
    raise exception 'estação % não encontrada', p_station_id;
  end if;
  if p_competencia is null then raise exception 'informe a competência'; end if;

  -- optional source document must be a fatura/boleto (same guard as set_charge_document)
  if p_document_id is not null then
    select kind into v_doc_kind from charging.documents where id = p_document_id;
    if not found then raise exception 'documento % não encontrado', p_document_id; end if;
    if v_doc_kind in ('comprovante', 'foto_medidor', 'contrato') then
      raise exception 'documento não é uma fatura/boleto de origem (tipo: %)', v_doc_kind;
    end if;
  end if;

  v_dedupe := 'manual:' || p_station_id || ':' || to_char(v_month, 'YYYY-MM') || ':' || p_kind;
  if exists (select 1 from charging.charges where dedupe_key = v_dedupe) then
    raise exception
      'já existe uma cobrança manual de % para a estação % em % — edite-a em vez de recriar',
      p_kind, p_station_id, to_char(v_month, 'YYYY-MM');
  end if;

  insert into charging.charges (
    billing_account_id, station_id, kind, competencia, competencia_source,
    amount, expected_amount, due_date, status, status_source, match_status,
    payment_method, source, source_document_id, dedupe_key, notes
  ) values (
    null, p_station_id, p_kind, v_month, 'explicit',
    p_amount, p_amount, p_due_date, 'pendente', 'rpc', 'manually_matched',
    p_payment_method, 'manual', p_document_id, v_dedupe, p_notes
  )
  returning id into v_charge_id;

  insert into charging.audit_events (entity_table, entity_id, event_type, actor_email, detail)
  values ('charges', v_charge_id::text, 'created', v_email,
    jsonb_build_object('source', 'manual', 'kind', p_kind, 'station_id', p_station_id,
      'competencia', to_char(v_month, 'YYYY-MM'), 'amount', p_amount,
      'document_id', p_document_id));

  return v_charge_id;
end;
$$;

revoke execute on function charging.create_manual_charge(charging.charge_kind, integer, date, numeric, date, charging.payment_method, uuid, text) from public, anon;
grant  execute on function charging.create_manual_charge(charging.charge_kind, integer, date, numeric, date, charging.payment_method, uuid, text) to authenticated;
