import "server-only";

/**
 * Arqia / gestaom2m API client (proxy.api.ip101.cloud) — the same 3 calls the
 * n8n workflow makes: login → listaSimcard (filtered by account) → consumo.
 * Credentials via env; NEVER hardcoded. Returns null when unconfigured so the
 * sync/cron/page degrade gracefully until Gabriel sets the env vars.
 */

import { parseDataUnitMb, round2 } from "./quota";

const BASE = "https://proxy.api.ip101.cloud/gestaom2m";

export interface ArqiaEnv {
  login: string;
  password: string;
  apiKey: string;
  customerId: string;
  accountFilter: string;
}

export function arqiaEnv(): ArqiaEnv | null {
  const login = process.env.ARQIA_LOGIN;
  const password = process.env.ARQIA_PASSWORD;
  const apiKey = process.env.ARQIA_API_KEY;
  const customerId = process.env.ARQIA_CUSTOMER_ID;
  if (!login || !password || !apiKey || !customerId) return null;
  return {
    login,
    password,
    apiKey,
    customerId,
    accountFilter: process.env.ARQIA_ACCOUNT_FILTER ?? "IOT FULL COMPARTILHADO",
  };
}

interface Contract {
  NM_SAITRO_ACCOUNT?: string | null;
  CD_ICCID?: string | null;
}

export interface ArqiaSnapshot {
  iccids: string[];
  accountName: string;
  consumptionMb: number;
}

async function login(env: ArqiaEnv): Promise<string> {
  const res = await fetch(`${BASE}/login`, {
    method: "POST",
    headers: {
      params: JSON.stringify({ login: env.login, password: env.password }),
      "Cache-Control": "no-cache",
      "Ocp-Apim-Subscription-Key": env.apiKey,
    },
  });
  if (!res.ok) throw new Error(`Arqia login falhou (${res.status})`);
  const body = (await res.json()) as { session_id?: string };
  if (!body.session_id) throw new Error("Arqia login sem session_id");
  return body.session_id;
}

function authHeaders(env: ArqiaEnv, sessionId: string): Record<string, string> {
  return {
    auth_info_gestao: sessionId,
    "Content-Type": "application/json",
    "Cache-Control": "no-cache",
    "Ocp-Apim-Subscription-Key": env.apiKey,
  };
}

async function listIccids(
  env: ArqiaEnv,
  sessionId: string,
): Promise<{ iccids: string[]; accountName: string }> {
  const res = await fetch(`${BASE}/contrato/listaSimcard`, {
    method: "POST",
    headers: authHeaders(env, sessionId),
    body: JSON.stringify({
      id_customer: env.customerId,
      pagination_offset: "0",
      pagination_next: "3000",
    }),
  });
  if (!res.ok) throw new Error(`Arqia listaSimcard falhou (${res.status})`);
  const body = (await res.json()) as { result?: { data?: { contracts?: Contract[] } } };
  const contracts = body?.result?.data?.contracts ?? [];
  const filtered = contracts.filter((c) => c.NM_SAITRO_ACCOUNT === env.accountFilter);
  const source = filtered.length > 0 ? filtered : contracts;
  const iccids = source
    .map((c) => c.CD_ICCID)
    .filter((x): x is string => x != null && x !== "");
  return { iccids, accountName: env.accountFilter };
}

async function getConsumptionMb(
  env: ArqiaEnv,
  sessionId: string,
  iccids: string[],
): Promise<number> {
  if (iccids.length === 0) return 0;
  const res = await fetch(`${BASE}/contrato/statusConexaoPlataformatConsumo`, {
    method: "POST",
    headers: authHeaders(env, sessionId),
    body: JSON.stringify({ resource_type: "iccid", resources: iccids }),
  });
  if (!res.ok) throw new Error(`Arqia consumo falhou (${res.status})`);
  const body = (await res.json()) as { resources?: { consumption?: string }[] };
  const resources = body?.resources ?? [];
  let total = 0;
  for (const r of resources) total += parseDataUnitMb(r.consumption);
  return round2(total);
}

/**
 * Full fetch: login → filtered iccids → total consumption (MB). Returns null if
 * unconfigured; throws on an API failure (the caller records it).
 */
export async function fetchArqiaSnapshot(): Promise<ArqiaSnapshot | null> {
  const env = arqiaEnv();
  if (!env) return null;
  const sessionId = await login(env);
  const { iccids, accountName } = await listIccids(env, sessionId);
  const consumptionMb = await getConsumptionMb(env, sessionId, iccids);
  return { iccids, accountName, consumptionMb };
}
