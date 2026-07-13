-- Boletos por e-mail (staging, decisão #47): discard_charges (bulk).
-- Backs the "Descartar" control of the /pagamentos › Documentos de e-mail tab:
-- a webhook-created charge the human judges wrong/irrelevant is RETIRED, never
-- deleted — status='cancelada' keeps the dedupe_key alive so an n8n redelivery
-- of the same document converges onto the cancelled charge and the ingest's
-- terminal guard (H4) prevents it from reopening. Mirrors reject_receipts
-- (migration 32: set-based, skip-not-error, count return, per-id audit) with
-- the retire pattern from merge_charge_into (migration 34).
--
-- Eligibility is deliberately confined to source='email_ai' (webhook-created
-- staging rows): a converged gerar_mes/scraper charge must NEVER be cancelled
-- by discard — its "wrong document" remedy is set_charge_document(null)
-- (Desvincular). That confinement is also why this RPC may set 'cancelada'
-- without update_charge_status's admin gate: the blast radius is only rows the
-- webhook itself created and no human has approved yet.
create or replace function charging.discard_charges(p_charge_ids uuid[], p_reason text)
returns integer
language plpgsql
security definer
set search_path to 'charging'
as $$
declare
  v_email text := charging.jwt_email();
  v_ids   uuid[];
begin
  if not charging.is_vammo_user() then raise exception 'não autorizado'; end if;
  if not charging.is_operator() then raise exception 'permissão de operador necessária'; end if;

  -- Elegível = linha de staging do webhook, ainda em revisão, não terminal,
  -- sem pagamentos alocados. O que não qualifica é PULADO, não erra — o
  -- retorno é quantas foram efetivamente descartadas.
  -- pag:-keyed rows are NEVER eligible: an email-first MATCHED aluguel owns the
  -- canonical gerar_mes key ('pag:{cadastro}:{YYYY-MM}:aluguel', #20/#27) — a
  -- cancelada row on that key would silently absorb gerar_mes' ON CONFLICT DO
  -- NOTHING insert and block the cadastro's rent for the month. Remedy for a
  -- wrong match = Reclassificar / Desvincular documento, never discard.
  with eligible as (
    select c.id
    from charging.charges c
    where c.id = any(p_charge_ids)
      and c.source = 'email_ai'
      and c.dedupe_key !~ '^pag:[0-9]+:'
      and c.match_status in ('unmatched', 'needs_review')
      and c.status not in ('pago', 'cancelada', 'nao_aplicavel', 'conciliado')
      and not exists (
        select 1 from charging.payments p where p.charge_id = c.id
      )
    for update
  ),
  upd as (
    update charging.charges c
    set status        = 'cancelada',
        status_source = 'rpc',
        match_status  = 'manually_matched',
        notes         = coalesce(c.notes || ' · ', '')
                        || 'descartada na revisão de documentos de e-mail'
                        || coalesce(' — ' || nullif(btrim(p_reason), ''), '')
    from eligible e
    where c.id = e.id
    returning c.id
  )
  select array_agg(id) into v_ids from upd;

  insert into charging.audit_events (entity_table, entity_id, event_type, actor_email, detail)
  select 'charges', id::text, 'discarded', v_email,
         jsonb_build_object('reason', p_reason, 'bulk', cardinality(p_charge_ids) > 1)
  from unnest(coalesce(v_ids, '{}'::uuid[])) as id;

  return coalesce(array_length(v_ids, 1), 0);
end;
$$;

revoke execute on function charging.discard_charges(uuid[], text) from public, anon;
grant execute on function charging.discard_charges(uuid[], text) to authenticated;
