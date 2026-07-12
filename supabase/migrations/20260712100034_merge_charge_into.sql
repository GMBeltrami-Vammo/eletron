-- Boletos por e-mail (spec 2026-07-11, Peça 2): merge_charge_into — unifies a
-- duplicate charge into the surviving one. Shapes it resolves (live batch
-- 2026-07-12): (a) the same boleto ingested twice (first delivery UNIDENTIFIED,
-- redelivery MATCHED onto the pag: clone charge); (b) an ND line vs the value-
-- only boleto sitting in the "banco". The duplicate donates its payment
-- instrument + document to the target, then is cancelled — never deleted
-- (payments/alerts FKs are RESTRICT; audit trail preserved).
create or replace function charging.merge_charge_into(
  p_duplicate_id uuid,
  p_target_id    uuid,
  p_reason       text
)
returns void
language plpgsql
security definer
set search_path to 'charging'
as $$
declare
  v_email text := charging.jwt_email();
  v_dup   charging.charges%rowtype;
  v_tgt   charging.charges%rowtype;
begin
  if not charging.is_vammo_user() then raise exception 'não autorizado'; end if;
  if p_duplicate_id = p_target_id then
    raise exception 'duplicada e destino são a mesma cobrança';
  end if;

  -- deterministic lock order avoids deadlocks between concurrent merges
  if p_duplicate_id < p_target_id then
    select * into v_dup from charging.charges where id = p_duplicate_id for update;
    select * into v_tgt from charging.charges where id = p_target_id for update;
  else
    select * into v_tgt from charging.charges where id = p_target_id for update;
    select * into v_dup from charging.charges where id = p_duplicate_id for update;
  end if;
  if v_dup.id is null then raise exception 'cobrança duplicada % não encontrada', p_duplicate_id; end if;
  if v_tgt.id is null then raise exception 'cobrança destino % não encontrada', p_target_id; end if;

  -- the duplicate must be an unsettled intake row: never pago, never já
  -- cancelada, e sem pagamentos alocados (esses casos são humanos/unmatch).
  if v_dup.status in ('pago', 'cancelada', 'nao_aplicavel') then
    raise exception 'cobrança duplicada está % — não pode ser unificada', v_dup.status;
  end if;
  if exists (select 1 from charging.payments p where p.charge_id = v_dup.id) then
    raise exception 'cobrança duplicada tem pagamentos alocados — remova-os antes';
  end if;
  -- a terminal/not-applicable target can't absorb a real payable (it would hide
  -- the duplicate behind a dead charge) — mirror the UI's isViableTarget guard.
  if v_tgt.status in ('cancelada', 'nao_aplicavel') then
    raise exception 'cobrança destino está %', v_tgt.status;
  end if;

  -- the duplicate donates what the target lacks (payment instrument, document,
  -- vencimento, sender) — never overwrites target data.
  update charging.charges
  set linha_digitavel    = coalesce(v_tgt.linha_digitavel, v_dup.linha_digitavel),
      chave_pix          = coalesce(v_tgt.chave_pix, v_dup.chave_pix),
      banco              = coalesce(v_tgt.banco, v_dup.banco),
      agencia            = coalesce(v_tgt.agencia, v_dup.agencia),
      conta              = coalesce(v_tgt.conta, v_dup.conta),
      due_date           = coalesce(v_tgt.due_date, v_dup.due_date),
      payment_method     = coalesce(v_tgt.payment_method, v_dup.payment_method),
      source_document_id = coalesce(v_tgt.source_document_id, v_dup.source_document_id),
      email_sender       = coalesce(v_tgt.email_sender, v_dup.email_sender),
      issuer_cnpj        = coalesce(v_tgt.issuer_cnpj, v_dup.issuer_cnpj)
  where id = v_tgt.id;

  -- retire the duplicate: cancelada (sticky) + resolved out of the review queue.
  update charging.charges
  set status = 'cancelada',
      status_source = 'rpc',
      match_status = 'manually_matched',
      notes = coalesce(notes || ' · ', '') || 'unificada com ' || v_tgt.dedupe_key
  where id = v_dup.id;

  insert into charging.audit_events (entity_table, entity_id, event_type, actor_email, detail)
  values
    ('charges', v_dup.id::text, 'merged_into', v_email,
      jsonb_build_object('target_id', v_tgt.id, 'target_dedupe', v_tgt.dedupe_key, 'reason', p_reason)),
    ('charges', v_tgt.id::text, 'merge_received', v_email,
      jsonb_build_object('duplicate_id', v_dup.id, 'duplicate_dedupe', v_dup.dedupe_key, 'reason', p_reason));
end;
$$;

revoke execute on function charging.merge_charge_into(uuid, uuid, text) from public, anon;
grant execute on function charging.merge_charge_into(uuid, uuid, text) to authenticated;
