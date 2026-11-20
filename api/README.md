# BhoomiPulse API: plug-and-play collateral intelligence

One handler (`handler.mjs`), three ways to run it, the same engine as the Command Center (`web/engine`).

| Deployment | When | How |
| --- | --- | --- |
| **Cloudflare Worker** (SaaS) | Pilots, smaller lenders, fastest start | `cd api && npx wrangler kv namespace create BP_KV` → paste the id into `wrangler.toml` → `npx wrangler secret put ADMIN_TOKEN` → `npx wrangler deploy` |
| **Docker / on-prem / VPC** | Banks and NBFCs that keep data in their own network (RBI outsourcing, DPDP) | `docker build -f api/Dockerfile -t bhoomipulse-api .` → `docker run -p 8787:8787 -e ADMIN_TOKEN=… -e STORE_PATH=/data/store.json -v bp:/data bhoomipulse-api` |
| **Node** (dev) | Local development, offline demo | `cd api && npm run mock` (simulated upstreams) or `ADMIN_TOKEN=x node server.mjs` (live) |

Docs: `GET /docs` (Redoc) and `GET /openapi.json`.

## Onboard a lender (tenant)

```bash
curl -X POST $API/v1/admin/tenants -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{
  "name": "Acme Housing Finance",
  "policy": { "ltv_caps": { "residential": 0.70, "agri_land": 0.50 }, "pd_12m": { "residential": 0.03 }, "el_threshold": 0.015 },
  "disabled_sources": [], "rate_limit_per_min": 300 }'
# → { "api_key": "bp_live_…", "tenant": { "webhook_secret": "whsec_…", … } }   (only the key's hash is stored)
```

Each tenant's credit policy (LTV caps, PD by asset type, expected-loss ceiling, cost of funds, score weights) is applied server-side, so the same asset can get a different LTV band at a conservative bank and an aggressive NBFC, while the evidence stays identical.

## Call it from a loan-origination system

```bash
curl -X POST $API/v1/assess -H "Authorization: Bearer $KEY" -H "Idempotency-Key: LAP-2026-00418" -H 'Content-Type: application/json' -d '{
  "reference_id": "LAP-2026-00418", "lat": 22.9957, "lon": 72.3759,
  "asset_type": "residential", "built_up_sqft": 1150, "loan_amount": 3500000, "declared_value": 6200000 }'
```

Response highlights: `score.grade`, `valuation.p10/p50/p90`, `liquidity.realisable_value`, `lending.recommended_ltv`, `flags[]`, `decision.route` (`fast_track` / `verify` / `refer`), `sources[]` with live status per source, `model_version`.

| Endpoint | Purpose |
| --- | --- |
| `POST /v1/assess` | One asset (lat/lon or polygon). ~3-12 s, 10 live sources. Idempotent with `Idempotency-Key`. |
| `GET /v1/assessments/{id}/report` | Printable HTML report for the credit file. |
| `POST /v1/batch` | Up to 2,000 assets; ≤25 return synchronously, larger runs return a job and a `batch.completed` webhook. |
| `POST /v1/portfolio/audit` | Book grade, exposure-weighted score, LTV breaches, flood exposure, district concentration, expected loss — for co-lending partners, pool buyers (PTC/DA) and equity investors. |
| `POST /v1/pulse/subscriptions` | Monitor a financed asset; monthly cron sends `pulse.alert` webhooks (flood, crop stress, activity drop). |
| `GET /v1/audit-log` | Decision trail (model version, sources, grade, route) for model-risk and FREE-AI reviews. |

Webhooks are signed: `X-BhoomiPulse-Signature: t=<unix>,v1=<HMAC-SHA256("t.body", webhook_secret)>`; verify with `verify_webhook()` (Python) or `verifyWebhook()` (JS) from `api/sdk/`.

## Embed in a screen

```html
<script type="module" src="https://silverintegral13.github.io/geospatial-intel/embed/bhoomipulse-widget.js"></script>
<bhoomipulse-card api="https://your-api" key="bp_live_…" lat="22.99" lon="72.37" asset-type="residential" built-up-sqft="1100" loan-amount="3500000"></bhoomipulse-card>
```

## Limits and notes

- Cloudflare Workers Free allows 50 sub-requests per invocation; one full assessment uses about 36. Use Workers Paid or the Docker server for large batches.
- Public sources have fair-use limits (Nominatim: 1 request/second, identify your app; Overpass: shared mirrors). Production runs should use a self-hosted Nominatim/Overpass or a commercial geocoder; the connector layer is already swappable.
- Enterprise connectors (ULI land records, CERSAI, eCourts, RERA, BAANKNET archive, jantri, PM GatiShakti, Bhuvan, Account Aggregator) appear in `/v1/sources` as `requires_credentials` and are enabled per tenant under a data agreement.
- Tests: `node api/test/engine.test.mjs && node api/test/api.test.mjs` (offline, simulated upstreams).
