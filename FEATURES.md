# BhoomiPulse v2 features

## Command Center (web/)
| Feature | Why it matters to a lender |
| --- | --- |
| Globe with live VIIRS night lights, twinkling "city sparkle" sampled from the NASA tiles in view, glowing road network, street-lamp twinkle from rendered roads, 3D buildings; epochs 2012 / 2016 / last night | Economic activity is visible at a glance; the sparkle is the data, not decoration |
| Search: places, addresses, 6-digit PIN codes, `lat, lon`, local city and district index | Get to the asset fast |
| Pin or trace the parcel (area in m² and acres), satellite toggle | Exact asset location and size |
| Collateral report: grade A–E, P10/P50/P90 value vs declared value, realisable value, days to sell, haircut, PD, recommended LTV and max loan, expected loss, hazards, Sentinel-2 true-colour + NDVI clips, NDVI and river history, rainfall by year, land-use timeline, red flags, routing decision, lineage table | One screen replaces a site visit for clean files and targets it for flagged ones |
| Tenant credit-policy presets (default, conservative PSB, growth NBFC, agri lender) | Same evidence, lender-specific appetite |
| Portfolio screening: CSV upload or sample book, fast 4-source screen, grade mix, concentration (HHI), LTV breaches, flood exposure, CSV export, one-click deep assessment | Score an entire loan book |
| **Investor Lens**: realisable cover, under-covered exposure, declared-vs-model inflation, stress tests (price shock, haircut, PD multiplier, monsoon flood), certificate export | For co-lending banks, PTC/DA pool buyers, rating analysts and equity investors: the "pipe between two businesses" |
| **Pulse**: watchlist, re-check from orbit (lights, NDVI, river forecast), activity index history, alert rules | Catch dying factories, unsown farms and floods before EMIs bounce |
| API console: endpoint builder, cURL / Python / JS / webhook / embed snippets, run the request on the same engine in-browser | Shows integration without a backend |
| Data fabric: live probe of every upstream, enterprise connectors, benchmarks, flow diagram | Shows where every number comes from |
| Command palette (Ctrl/⌘+K), keyboard shortcuts, night-flight tour (F), pipeline console, offline demo mode | Demo-proof and fast to operate |

## API (api/)
`POST /v1/assess` · `GET /v1/assessments/{id}[/report]` · `POST /v1/batch` (sync ≤25, async jobs + `batch.completed` webhook) ·
`POST /v1/portfolio/audit` · Pulse subscriptions + monthly cron + signed `pulse.alert` webhooks · `GET /v1/audit-log` ·
per-tenant API keys (hashed), credit policy, rate limits, idempotency keys · OpenAPI 3.1 at `/openapi.json`, docs at `/docs` ·
Cloudflare Worker, Docker/on-prem and Node deployments · Python and JS SDKs · `<bhoomipulse-card>` widget.
