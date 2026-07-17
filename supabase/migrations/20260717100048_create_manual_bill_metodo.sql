-- create_manual_bill — carry the manual "método" (DA vs Boleto) through the
-- existing p_energy_details jsonb (Gabriel 2026-07-17): no signature change, so
-- a plain create-or-replace (no DROP → no PostgREST overload). The Nova Cobrança
-- Manual dialog now lets the human set the fatura's payment method; DA →
-- payment_method 'debito_automatico' + charge_energy_details.auto_debit
-- 'cadastrado', Boleto → 'boleto_email' + 'nao_cadastrado'. That auto_debit is
-- the single per-bill DA fact the fiscal send reads for column B (#42) — and,
-- consistently, the comprovante matcher gates on (#58). Everything else
-- (dedupe C1, energy details, audit) unchanged.

create or replace function charging.create_manual_bill(
  p_billing_account_id uuid,
  p_competencia        date,
  p_due_date           date,
  p_amount             numeric,
  p_document_id        uuid,
  p_nf                 text,
  p_energy_details     jsonb,
  p_notes              text
)
returns uuid
language plpgsql
security definer
set search_path to 'charging'
as $$
declare
  v_email  text := charging.jwt_email();
  v_acct   charging.billing_accounts%rowtype;
  v_dedupe text;
  v_id     uuid;
begin
  if not charging.is_vammo_user() then raise exception 'not authorized'; end if;
  if not charging.is_operator() then raise exception 'operator role required'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'amount must be > 0'; end if;
  if p_due_date is null then raise exception 'due_date is required'; end if;

  select * into v_acct from charging.billing_accounts where id = p_billing_account_id for update;
  if not found then raise exception 'billing account % not found', p_billing_account_id; end if;
  if v_acct.account_type not in ('energy_enel','energy_edp') then
    raise exception 'manual bills are only for energy_enel / energy_edp accounts';
  end if;

  -- C1: reuse the scraper dedupe recipe so a later scraper import / sheet
  -- write-back of this row converges on THIS charge instead of duplicating it.
  if v_acct.account_type = 'energy_enel' then
    if v_acct.enel_id is null then raise exception 'account has no enel_id'; end if;
    v_dedupe := 'enel:' || v_acct.enel_id || ':' || to_char(p_due_date, 'YYYY-MM-DD');
  else
    if v_acct.edp_uc is null then raise exception 'account has no edp_uc'; end if;
    v_dedupe := 'edp:' || v_acct.edp_uc || ':' || to_char(p_due_date, 'YYYY-MM-DD');
  end if;

  -- one charge per logical bill: refuse if the scraper (or a prior manual entry)
  -- already produced it. Doubles as the double-submit guard.
  if exists (select 1 from charging.charges where dedupe_key = v_dedupe) then
    raise exception 'a charge already exists for this account and due date (%)', v_dedupe;
  end if;

  insert into charging.charges (
    billing_account_id, station_id, kind, competencia, competencia_source,
    amount, expected_amount, due_date, status, status_source, match_status,
    source, source_document_id, nota_fiscal, issuer_cnpj, dedupe_key, notes,
    payment_method
  ) values (
    p_billing_account_id, v_acct.station_id, 'energia', p_competencia,
    (case when p_competencia is null then 'unknown' else 'manual' end)::charging.competencia_source,
    p_amount, p_amount, p_due_date, 'pendente', 'rpc',
    (case when v_acct.station_id is null then 'unmatched' else 'manually_matched' end)::charging.match_status,
    'manual', p_document_id, coalesce(p_nf, p_energy_details ->> 'nf'),
    p_energy_details ->> 'issuer_cnpj', v_dedupe, p_notes,
    nullif(p_energy_details ->> 'payment_method', '')::charging.payment_method
  )
  returning id into v_id;

  insert into charging.charge_energy_details (
    charge_id, nf, classificacao, modalidade, tipo_fornecimento,
    tusd_kwh, tusd_amount, te_kwh, te_amount, cip, sub_faturamento, total,
    auto_debit, auto_debit_registration, fatura_drive_url
  ) values (
    v_id,
    coalesce(p_nf, p_energy_details ->> 'nf'),
    p_energy_details ->> 'classificacao',
    p_energy_details ->> 'modalidade',
    p_energy_details ->> 'tipo_fornecimento',
    (p_energy_details ->> 'tusd_kwh')::numeric,
    (p_energy_details ->> 'tusd_amount')::numeric,
    (p_energy_details ->> 'te_kwh')::numeric,
    (p_energy_details ->> 'te_amount')::numeric,
    (p_energy_details ->> 'cip')::numeric,
    (p_energy_details ->> 'sub_faturamento')::numeric,
    coalesce((p_energy_details ->> 'total')::numeric, p_amount),
    nullif(p_energy_details ->> 'auto_debit', '')::charging.auto_debit_status,
    p_energy_details ->> 'auto_debit_registration',
    p_energy_details ->> 'fatura_drive_url'
  );

  insert into charging.audit_events (entity_table, entity_id, event_type, actor_email, detail)
  values ('charges', v_id::text, 'created', v_email,
    jsonb_build_object('source', 'manual', 'dedupe_key', v_dedupe, 'amount', p_amount,
      'billing_account_id', p_billing_account_id, 'document_id', p_document_id));
  return v_id;
end;
$$;
