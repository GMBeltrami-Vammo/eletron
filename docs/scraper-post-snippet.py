"""
post_to_eletron — dual-write helper for the Vammo-Enel scrapers (eletron decision #34).

Call this ALONGSIDE the existing gspread write, once per installation, right after
the scraper builds the account row (STATIC_HEADERS) and any fatura rows
(FATURAS_HEADERS). It sends THE SAME row-dicts the scraper writes to the sheet, so
eletron parses them with its existing `normalize.ts` — near-zero new logic on both
sides. The sheet write stays the source for the downstream weekly-matching + Slack
scripts; this POST feeds the eletron app's `charging` schema in parallel.

Setup (scraper side, per eletron CLAUDE.md — the scraper stays Gabriel's):
  pip install requests
  export ELETRON_INGEST_SECRET=...            # matches Vercel SCRAPER_INGEST_SECRET
  export ELETRON_INGEST_URL=https://<eletron-domain>/api/ingest/scraper

Behavior / contract:
  - provider is "enel" or "edp".
  - account_row_dict: the enel_data / edp_data row as a plain dict (verbatim headers,
    e.g. "enel_id"/"uc", "status", "due_date", "auto_debit", "F_JUL26"/"jul26", ...).
  - fatura_row_dicts: 0..N Faturas_ENEL / Faturas_EDP row dicts (verbatim headers,
    incl. "link_fatura" = '=HYPERLINK("<webViewLink>";"Ver Fatura")', "value",
    "due_date", "TUSD (kWh)", ...). Pass [] for a "detected, PDF pending" state — the
    app then shows Ciclo "Detectada" and creates NO charge.
  - Idempotent: charges dedupe on enel:{id}:{due} / edp:{uc}:{due}, so re-sending the
    same scrape converges (no duplicates). Existing station matches are preserved
    (the app never overwrites a matched billing account from this feed).
"""

from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

import requests


def post_to_eletron(
    provider: str,
    account_row_dict: Dict[str, Any],
    fatura_row_dicts: Optional[List[Dict[str, Any]]] = None,
    *,
    timeout: int = 30,
) -> Dict[str, Any]:
    """POST one installation (account + its faturas) to the eletron ingest feed.

    Returns the parsed JSON stats on success; raises requests.HTTPError otherwise.
    """
    url = os.environ.get(
        "ELETRON_INGEST_URL", "https://<eletron-domain>/api/ingest/scraper"
    )
    secret = os.environ["ELETRON_INGEST_SECRET"]  # KeyError early if unset

    installation_key = str(
        account_row_dict.get("enel_id") or account_row_dict.get("uc") or ""
    )
    payload = {
        "provider": provider,  # "enel" | "edp"
        "installations": [
            {
                "installationKey": installation_key,
                "account": account_row_dict,
                "faturas": fatura_row_dicts or [],
            }
        ],
    }

    resp = requests.post(
        url,
        json=payload,
        headers={"Authorization": f"Bearer {secret}"},
        timeout=timeout,
    )
    resp.raise_for_status()
    return resp.json()


if __name__ == "__main__":
    # Illustrative only — the scraper passes its real row dicts.
    demo_account = {
        "enel_id": "204454589",
        "status": "Pendente",
        "due_date": "2026-07-20",
        "auto_debit": "Cadastrado",
        "last_billing": "R$ 1.234,56",
        "scraping_time": "2026-07-09 03:00:00",
    }
    demo_fatura = {
        "enel_id": "204454589",
        "value": "R$ 1.234,56",
        "due_date": "2026-07-20",
        "link_fatura": '=HYPERLINK("https://drive.google.com/file/d/abc/view";"Ver Fatura")',
        "Total": "1234,56",
    }
    print(post_to_eletron("enel", demo_account, [demo_fatura]))
