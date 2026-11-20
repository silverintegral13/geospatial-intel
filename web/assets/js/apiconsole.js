// API console: deployment options, request builder that runs the same engine locally, SDK snippets, tenant policy.
import { assess, assessMany, portfolioAudit, pulseSnapshot, mergePolicy } from '../../engine/index.js';
import { S, store } from './state.js';
import { engineEnv, TENANTS, log } from './engine-env.js';
import { toast } from './map.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let tab = 'curl', ep = 'assess', resp = null;
const base = () => store.get('apiBase', 'https://bhoomipulse-api.<your-subdomain>.workers.dev');

function sampleBody() {
  const a = S.asset || { lat: 22.9957, lon: 72.3759 };
  if (ep === 'assess') return { reference_id: 'LAP-2026-00418', lat: +a.lat.toFixed(6), lon: +a.lon.toFixed(6), asset_type: S.assetType, built_up_sqft: 1150, area_sqm: a.area_sqm || undefined, loan_amount: 3500000, declared_value: 6200000 };
  if (ep === 'portfolio/audit') return { loans: [{ reference_id: 'L1', lat: 22.9957, lon: 72.3759, asset_type: 'residential', loan_amount: 2500000 }, { reference_id: 'L2', lat: 22.9883, lon: 72.2626, asset_type: 'industrial', loan_amount: 30000000, area_sqm: 8000 }, { reference_id: 'L3', lat: 22.889, lon: 72.223, asset_type: 'agri_land', loan_amount: 700000, area_sqm: 12000 }] };
  if (ep === 'batch') return { mode: 'fast', webhook_url: 'https://los.lender.example/hooks/bhoomipulse', assets: [{ reference_id: 'L1', lat: 22.9957, lon: 72.3759, asset_type: 'residential', loan_amount: 2500000 }] };
  return { asset: { lat: +a.lat.toFixed(6), lon: +a.lon.toFixed(6), asset_type: S.assetType }, webhook_url: 'https://collections.lender.example/hooks/pulse', cadence: 'monthly' };
}
const path = () => ({ assess: '/v1/assess', 'portfolio/audit': '/v1/portfolio/audit', batch: '/v1/batch', 'pulse/subscriptions': '/v1/pulse/subscriptions' }[ep]);

function snippet(body) {
  const j = JSON.stringify(body, null, 2);
  if (tab === 'curl') return `curl -X POST ${base()}${path()} \\\n  -H "Authorization: Bearer $BHOOMIPULSE_KEY" \\\n  -H "Content-Type: application/json" \\\n  -H "Idempotency-Key: ${body.reference_id || 'req-001'}" \\\n  -d '${j}'`;
  if (tab === 'python') return `# pip-free client: api/sdk/python/bhoomipulse.py\nfrom bhoomipulse import Client\nbp = Client("${base()}", api_key=os.environ["BHOOMIPULSE_KEY"])\n\n${ep === 'assess' ? `r = bp.assess(**${pyDict(body)})\nprint(r["score"]["grade"], r["valuation"]["p50"], r["decision"]["route"])\nif r["decision"]["field_visit"]:\n    los.create_task("site_visit", ref=r["reference_id"], flags=r["flags"])` : ep === 'portfolio/audit' ? `audit = bp.portfolio_audit(loans=${pyDict(body.loans)})\nprint(audit["book_grade"], audit["exposure_weighted_cqs"], audit["el_rate"])` : ep === 'batch' ? `job = bp.batch(${pyDict(body.assets)}, mode="fast", webhook_url="${body.webhook_url}")` : `bp.monitor(${pyDict(body.asset)}, webhook_url="${body.webhook_url}")`}`;
  if (tab === 'js') return `import { BhoomiPulse } from './sdk/js/bhoomipulse.mjs';\nconst bp = new BhoomiPulse('${base()}', process.env.BHOOMIPULSE_KEY);\n\n${ep === 'assess' ? `const r = await bp.assess(${j}, { idempotencyKey: '${body.reference_id}' });\nconsole.log(r.score.grade, r.lending.recommended_ltv, r.flags);` : ep === 'portfolio/audit' ? `const audit = await bp.portfolioAudit(${JSON.stringify(body.loans, null, 2)});` : ep === 'batch' ? `const job = await bp.batch(${JSON.stringify(body.assets)}, { webhookUrl: '${body.webhook_url}' });` : `await bp.monitor(${JSON.stringify(body.asset)}, { webhookUrl: '${body.webhook_url}' });`}`;
  if (tab === 'webhook') return `# Flask receiver for pulse.alert / batch.completed\nfrom bhoomipulse import verify_webhook\n\n@app.post("/hooks/bhoomipulse")\ndef hook():\n    if not verify_webhook(WEBHOOK_SECRET, request.headers["X-BhoomiPulse-Signature"], request.get_data()):\n        abort(401)\n    evt = request.get_json()\n    if evt["type"] == "pulse.alert":\n        for a in evt["data"]["snapshot"]["alerts"]:\n            collections_queue.push(loan=evt["data"]["asset"].get("reference_id"), priority=a["severity"], reason=a["text"])\n    return "", 204`;
  return `<!-- Inside the lender's LOS / CRM screen -->\n<script type="module" src="https://silverintegral13.github.io/geospatial-intel/embed/bhoomipulse-widget.js"></script>\n<bhoomipulse-card api="${base()}" key="bp_live_… (short-lived, origin-restricted)"\n  lat="${body.lat ?? 22.99}" lon="${body.lon ?? 72.37}" asset-type="${body.asset_type || 'residential'}"\n  built-up-sqft="1150" loan-amount="3500000"></bhoomipulse-card>\n<script>\n  document.querySelector('bhoomipulse-card').addEventListener('assessed', (e) => los.attach(e.detail));\n</script>`;
}
const pyDict = (o) => JSON.stringify(o, null, 4).replace(/: null/g, ': None').replace(/: true/g, ': True').replace(/: false/g, ': False');
function hl(json) {
  return esc(json).replace(/(&quot;[^&]*?&quot;)(\s*:)?|\b(true|false|null)\b|-?\d+(\.\d+)?(e[+-]?\d+)?/g, (m, str, colon, bool) => str ? (colon ? `<span class="k-key">${str}</span>${colon}` : `<span class="k-str">${str}</span>`) : bool ? `<span class="k-bool">${m}</span>` : `<span class="k-num">${m}</span>`);
}

export function renderApi() {
  const el = $('#panelInner'); const body = sampleBody();
  el.innerHTML = `
  <div class="ph"><div><div class="kicker">INTEGRATION</div><h2>Plug it into any lending stack</h2><p>One REST API, three deployments, per-lender credit policy, signed webhooks, audit log.</p></div></div>
  <div class="sec"><div class="kpis" style="grid-template-columns:1fr 1fr">
    <div class="kpi"><span>SaaS · Cloudflare edge</span><b style="font-size:13px">npx wrangler deploy</b></div>
    <div class="kpi"><span>Private cloud / on-prem</span><b style="font-size:13px">docker run bhoomipulse-api</b></div>
    <div class="kpi"><span>LOS / CRM screen</span><b style="font-size:13px">&lt;bhoomipulse-card&gt;</b></div>
    <div class="kpi"><span>Bulk data tapes</span><b style="font-size:13px">POST /v1/batch</b></div></div>
    <p class="hint">Docs at <code>/docs</code> (OpenAPI 3.1). Code in <code>api/</code>: Worker, Node/Docker server, Python &amp; JS SDKs, widget.</p></div>
  <div class="sec"><h3>Endpoint</h3><div class="btns" style="margin-top:0">${['assess', 'portfolio/audit', 'batch', 'pulse/subscriptions'].map((e) => `<button class="btn ${e === ep ? 'pri' : ''}" data-ep="${e}">POST /v1/${e}</button>`).join('')}</div>
    <label class="field" style="margin-top:8px">API base URL<input id="apiBase" value="${esc(base())}"></label>
    <div class="tabs">${[['curl', 'cURL'], ['python', 'Python'], ['js', 'JavaScript'], ['webhook', 'Webhook'], ['embed', 'Embed']].map(([k, l]) => `<button data-tab="${k}" class="${k === tab ? 'on' : ''}">${l}</button>`).join('')}</div>
    <pre class="code" id="snip">${esc(snippet(body))}</pre>
    <div class="btns"><button class="btn" id="copySnip">⧉ Copy</button><button class="btn pri" id="tryBtn">▶ Run this request here (same engine)</button></div></div>
  <div class="sec" id="respSec" ${resp ? '' : 'hidden'}><h3>Response <small id="respMeta"></small></h3><pre class="code" id="resp"></pre></div>
  <div class="sec"><h3>Tenant credit policy <small>applied server-side per API key</small></h3>
    <label class="field">Preset<select id="tenantSel">${Object.entries(TENANTS).map(([k, v]) => `<option value="${k}" ${k === S.tenant ? 'selected' : ''}>${v.name}</option>`).join('')}</select></label>
    <pre class="code" style="max-height:200px">${hl(JSON.stringify((({ ltv_caps, pd_12m, el_threshold, cost_of_funds }) => ({ ltv_caps, pd_12m, el_threshold, cost_of_funds }))(mergePolicy(TENANTS[S.tenant].policy)), null, 2))}</pre>
    <p class="hint">Same evidence, different appetite: a conservative bank and a growth NBFC get different LTV bands from identical satellite and market data. Switch the preset and re-run an assessment to see it.</p></div>
  <div class="sec"><h3>Lifecycle</h3><svg viewBox="0 0 400 120" style="width:100%;height:auto">
    ${[['LOS', 10], ['/v1/assess', 100], ['decision', 200], ['/pulse', 290]].map(([t, x], i) => `<rect x="${x}" y="20" width="84" height="34" rx="9" fill="#060b18" stroke="${i % 2 ? '#ffb547' : '#5ce1ff'}" stroke-opacity=".7"/><text x="${x + 42}" y="41" fill="#e8eefb" font-size="11" text-anchor="middle" font-family="JetBrains Mono">${t}</text>`).join('')}
    ${[94, 184, 284].map((x) => `<path d="M${x} 37h6" stroke="#a9b6d3" marker-end="url(#ar)"/>`).join('')}
    <defs><marker id="ar" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0 6 3 0 6Z" fill="#a9b6d3"/></marker></defs>
    <text x="52" y="78" fill="#71809f" font-size="10" text-anchor="middle">application</text><text x="142" y="78" fill="#71809f" font-size="10" text-anchor="middle">10 sources, ~8 s</text><text x="242" y="78" fill="#71809f" font-size="10" text-anchor="middle">fast-track / verify / refer</text><text x="332" y="78" fill="#71809f" font-size="10" text-anchor="middle">monthly webhooks</text>
    <text x="200" y="108" fill="#ffd98a" font-size="10.5" text-anchor="middle">every call → audit log: model version · sources · grade · route</text></svg></div>`;
  el.querySelectorAll('[data-ep]').forEach((b) => b.onclick = () => { ep = b.dataset.ep; resp = null; renderApi(); });
  el.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => { tab = b.dataset.tab; renderApi(); });
  $('#apiBase').onchange = (e) => { store.set('apiBase', e.target.value.trim()); renderApi(); };
  $('#tenantSel').onchange = (e) => { S.tenant = e.target.value; store.set('tenant', S.tenant); renderApi(); };
  $('#copySnip').onclick = async () => { try { await navigator.clipboard.writeText($('#snip').textContent); toast('Copied'); } catch { toast('Copy blocked by the browser'); } };
  $('#tryBtn').onclick = async () => {
    const b = $('#tryBtn'); b.disabled = true; b.textContent = 'Running…'; const t0 = Date.now();
    log(`<span class="hl">API</span> POST ${path()} (local engine, tenant=${S.tenant})`);
    try {
      let out;
      if (ep === 'assess') out = await assess(body, engineEnv());
      else if (ep === 'portfolio/audit') { const r = await assessMany(body.loans, engineEnv(), { mode: 'fast' }); out = portfolioAudit(r); }
      else if (ep === 'batch') { const r = await assessMany(body.assets, engineEnv(), { mode: 'fast' }); out = { id: 'job_local', status: 'completed', audit: portfolioAudit(r) }; }
      else out = { id: 'sub_local', ...body, last_snapshot: await pulseSnapshot(body.asset, engineEnv()) };
      resp = out; const show = ep === 'assess' ? { ...out, signals: { '…': `${Object.keys(out.signals).length} raw features (truncated here)` } } : out;
      $('#respSec').hidden = false; $('#resp').innerHTML = hl(JSON.stringify(show, null, 2)); $('#respMeta').textContent = `200 OK · ${Date.now() - t0} ms${S.offline ? ' · SIMULATED' : ''}`;
    } catch (e) { $('#respSec').hidden = false; $('#resp').textContent = JSON.stringify({ error: { message: e.message } }, null, 2); }
    b.disabled = false; b.textContent = '▶ Run this request here (same engine)';
  };
}
