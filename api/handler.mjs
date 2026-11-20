// BhoomiPulse API: one request handler shared by the Cloudflare Worker (api/worker.js)
// and the Node / Docker on-prem server (api/server.mjs).
import { assess, assessMany, portfolioAudit, pulseSnapshot, SOURCES, ENTERPRISE_CONNECTORS, ASSET_TYPES, DEFAULT_POLICY, VERSION, MODEL_VERSION } from '../web/engine/index.js';
import { renderReport } from '../web/engine/report.js';
import { OPENAPI } from './openapi.mjs';

const SYNC_BATCH_LIMIT = 25;
const MAX_BATCH = 2000;

const enc = new TextEncoder();
async function sha256hex(s) { const d = await crypto.subtle.digest('SHA-256', enc.encode(s)); return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join(''); }
async function hmac(secret, msg) {
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(msg)))].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const rid = () => 'req_' + [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, '0')).join('');
const newKey = () => 'bp_live_' + [...crypto.getRandomValues(new Uint8Array(20))].map((b) => b.toString(16).padStart(2, '0')).join('');

export function createHandler(cfg) {
  const { store, env = {} } = cfg;
  const engineEnv = (tenant) => ({
    fetch: cfg.fetch, decodeImage: cfg.decodeImage, districtLookup: cfg.districtLookup,
    policy: tenant?.policy, disabled: tenant?.disabled_sources || [],
    uaHeaders: { 'User-Agent': `BhoomiPulse-API/${VERSION} (${env.CONTACT_EMAIL || 'ops@bhoomipulse.example'})` },
  });

  const cors = {
    'Access-Control-Allow-Origin': env.CORS_ORIGIN || '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Idempotency-Key, X-Admin-Token',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Expose-Headers': 'X-Request-Id, X-RateLimit-Remaining, X-Model-Version',
  };
  const send = (body, status = 200, extra = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body, null, 2), {
    status, headers: { 'Content-Type': typeof body === 'string' && !extra['Content-Type'] ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', ...cors, ...extra },
  });
  const fail = (status, code, message, extra) => send({ error: { code, message } }, status, extra);

  async function authenticate(req) {
    const h = req.headers.get('Authorization') || '';
    const key = h.startsWith('Bearer ') ? h.slice(7).trim() : new URL(req.url).searchParams.get('api_key');
    if (!key) return null;
    if (env.DEMO_KEY && key === env.DEMO_KEY) return { id: 'demo', name: 'Public demo tenant', policy: {}, rate_limit_per_min: 20, demo: true, webhook_secret: 'demo-secret' };
    return store.get('tenant:' + (await sha256hex(key)));
  }

  async function rateLimit(tenant) {
    const limit = tenant.rate_limit_per_min || 120;
    const k = `rl:${tenant.id}:${Math.floor(Date.now() / 60000)}`;
    const n = ((await store.get(k)) || 0) + 1;
    await store.put(k, n, { ttl: 120 });
    return { ok: n <= limit, remaining: Math.max(0, limit - n) };
  }

  async function audit(tenant, entry) {
    const k = `audit:${tenant.id}:${new Date().toISOString()}:${entry.request_id}`;
    await store.put(k, entry, { ttl: 60 * 60 * 24 * 400 });
  }

  async function deliverWebhook(tenant, url, event, data) {
    const body = JSON.stringify({ id: rid().replace('req', 'evt'), type: event, created_at: new Date().toISOString(), data });
    const ts = Math.floor(Date.now() / 1000);
    const sig = await hmac(tenant.webhook_secret || 'unset', `${ts}.${body}`);
    try {
      const r = await (cfg.webhookFetch || cfg.fetch || fetch)(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-BhoomiPulse-Signature': `t=${ts},v1=${sig}` }, body });
      return { status: r.status };
    } catch (e) { return { status: 0, error: String(e.message || e) }; }
  }

  async function runBatch(tenant, jobId, assets, mode, webhook) {
    const job = (await store.get('job:' + jobId)) || {};
    const results = await assessMany(assets, engineEnv(tenant), {
      mode, concurrency: 4,
      onProgress: async (done, total) => { if (done % 10 === 0 || done === total) await store.put('job:' + jobId, { ...job, status: 'running', done, total }, { ttl: 86400 * 7 }); },
    });
    const slim = results.map(slimResult);
    const out = { ...job, id: jobId, status: 'completed', done: results.length, total: results.length, completed_at: new Date().toISOString(), audit: portfolioAudit(results), results: slim };
    await store.put('job:' + jobId, out, { ttl: 86400 * 7 });
    if (webhook) await deliverWebhook(tenant, webhook, 'batch.completed', { job_id: jobId, audit: out.audit });
    return out;
  }

  async function runPulse(tenant) {
    const subs = await store.list(`sub:${tenant.id}:`);
    const report = [];
    for (const { key, value: sub } of subs) {
      const prev = sub.last_snapshot || null;
      try {
        const snap = await pulseSnapshot({ ...sub.asset, asset_id: sub.id }, engineEnv(tenant), prev);
        sub.last_snapshot = snap; sub.history = [...(sub.history || []), { t: snap.taken_at, activity: snap.activity_index, ndvi: snap.ndvi_latest, flood: snap.flood_alert }].slice(-36);
        await store.put(key, sub);
        let delivery = null;
        if (snap.alerts.length && sub.webhook_url) delivery = await deliverWebhook(tenant, sub.webhook_url, 'pulse.alert', { subscription_id: sub.id, asset: sub.asset, snapshot: snap });
        report.push({ id: sub.id, alerts: snap.alerts.length, delivery });
      } catch (e) { report.push({ id: sub.id, error: String(e.message || e) }); }
    }
    return report;
  }

  async function handle(req, ctx = {}) {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const reqId = rid();
    const H = { 'X-Request-Id': reqId, 'X-Model-Version': MODEL_VERSION };
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      // ---------- public ----------
      if (path === '/' || path === '/v1') return send({ name: 'BhoomiPulse Collateral Intelligence API', version: VERSION, model_version: MODEL_VERSION, docs: '/docs', openapi: '/openapi.json', endpoints: ['GET /v1/health', 'GET /v1/sources', 'POST /v1/assess', 'GET /v1/assessments/{id}', 'GET /v1/assessments/{id}/report', 'POST /v1/batch', 'GET /v1/jobs/{id}', 'POST /v1/portfolio/audit', 'POST /v1/pulse/subscriptions', 'GET /v1/pulse/subscriptions', 'DELETE /v1/pulse/subscriptions/{id}', 'POST /v1/pulse/run', 'GET /v1/audit-log', 'GET /v1/tenant'] }, 200, H);
      if (path === '/v1/health') return send({ status: 'ok', version: VERSION, model_version: MODEL_VERSION, time: new Date().toISOString() }, 200, H);
      if (path === '/openapi.json') return send(OPENAPI, 200, H);
      if (path === '/docs') return send(`<!doctype html><html><head><title>BhoomiPulse API</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}</style></head><body><redoc spec-url="/openapi.json"></redoc><script src="https://cdn.jsdelivr.net/npm/redoc@2.1.5/bundles/redoc.standalone.js"></script></body></html>`, 200, { ...H, 'Content-Type': 'text/html; charset=utf-8' });
      if (path === '/v1/sources') return send({ live: SOURCES.map(({ run, ...s }) => s), enterprise: ENTERPRISE_CONNECTORS, asset_types: Object.fromEntries(Object.entries(ASSET_TYPES).map(([k, v]) => [k, v.label])), default_policy: DEFAULT_POLICY }, 200, H);

      // ---------- admin ----------
      if (path.startsWith('/v1/admin/')) {
        if (!env.ADMIN_TOKEN || req.headers.get('X-Admin-Token') !== env.ADMIN_TOKEN) return fail(401, 'unauthorized', 'admin token required', H);
        if (path === '/v1/admin/tenants' && req.method === 'POST') {
          const b = await req.json();
          const key = newKey();
          const tenant = { id: b.id || 'tn_' + reqId.slice(4, 12), name: b.name || 'Unnamed lender', policy: b.policy || {}, disabled_sources: b.disabled_sources || [], rate_limit_per_min: b.rate_limit_per_min || 120, webhook_secret: newKey().replace('bp_live_', 'whsec_'), created_at: new Date().toISOString() };
          await store.put('tenant:' + (await sha256hex(key)), tenant);
          return send({ tenant, api_key: key, note: 'Store the API key now; only its hash is kept.' }, 201, H);
        }
        if (path === '/v1/admin/pulse/run-all' && req.method === 'POST') return send({ ran: await runAllPulse() }, 200, H);
        return fail(404, 'not_found', 'unknown admin route', H);
      }

      // ---------- tenant ----------
      const tenant = await authenticate(req);
      if (!tenant) return fail(401, 'unauthorized', 'Send Authorization: Bearer <api key>', H);
      const rl = await rateLimit(tenant);
      H['X-RateLimit-Remaining'] = String(rl.remaining);
      if (!rl.ok) return fail(429, 'rate_limited', 'Per-minute limit reached', H);

      if (path === '/v1/tenant') return send({ id: tenant.id, name: tenant.name, policy: { ...DEFAULT_POLICY, ...tenant.policy }, disabled_sources: tenant.disabled_sources || [], rate_limit_per_min: tenant.rate_limit_per_min }, 200, H);

      if (path === '/v1/assess' && req.method === 'POST') {
        const idem = req.headers.get('Idempotency-Key');
        if (idem) { const hit = await store.get(`idem:${tenant.id}:${idem}`); if (hit) return send(hit, 200, { ...H, 'Idempotent-Replay': 'true' }); }
        const body = await req.json().catch(() => null);
        if (!body) return fail(400, 'bad_request', 'JSON body required', H);
        const r = await assess(body, engineEnv(tenant));
        await store.put(`asm:${tenant.id}:${r.id}`, r, { ttl: 86400 * 30 });
        if (idem) await store.put(`idem:${tenant.id}:${idem}`, r, { ttl: 86400 });
        await audit(tenant, { request_id: reqId, endpoint: 'assess', assessment_id: r.id, reference_id: r.reference_id, model_version: r.model_version, grade: r.score.grade, decision: r.decision.route, sources_ok: r.provenance.live_sources_ok, at: r.created_at });
        return send(r, 200, H);
      }
      let m;
      if ((m = path.match(/^\/v1\/assessments\/(asm_[\w]+)(\/report)?$/))) {
        const r = await store.get(`asm:${tenant.id}:${m[1]}`);
        if (!r) return fail(404, 'not_found', 'assessment not found or expired', H);
        return m[2] ? send(renderReport(r), 200, { ...H, 'Content-Type': 'text/html; charset=utf-8' }) : send(r, 200, H);
      }
      if (path === '/v1/batch' && req.method === 'POST') {
        const b = await req.json();
        const assets = (b.assets || []).slice(0, MAX_BATCH);
        if (!assets.length) return fail(400, 'bad_request', 'assets[] required', H);
        const mode = b.mode === 'full' ? 'full' : 'fast';
        const jobId = 'job_' + reqId.slice(4);
        await store.put('job:' + jobId, { id: jobId, tenant: tenant.id, status: 'queued', total: assets.length, done: 0, mode, created_at: new Date().toISOString() }, { ttl: 86400 * 7 });
        await audit(tenant, { request_id: reqId, endpoint: 'batch', job_id: jobId, n: assets.length, mode, at: new Date().toISOString() });
        if (assets.length <= SYNC_BATCH_LIMIT && !b.webhook_url) return send(await runBatch(tenant, jobId, assets, mode, null), 200, H);
        const p = runBatch(tenant, jobId, assets, mode, b.webhook_url);
        ctx.waitUntil ? ctx.waitUntil(p) : p.catch(() => {});
        return send({ id: jobId, status: 'queued', total: assets.length, poll: `/v1/jobs/${jobId}` }, 202, H);
      }
      if ((m = path.match(/^\/v1\/jobs\/(job_\w+)$/))) {
        const j = await store.get('job:' + m[1]);
        if (!j || j.tenant !== tenant.id) return fail(404, 'not_found', 'job not found', H);
        return send(j, 200, H);
      }
      if (path === '/v1/portfolio/audit' && req.method === 'POST') {
        const b = await req.json();
        const loans = (b.loans || []).slice(0, SYNC_BATCH_LIMIT * 4);
        const results = await assessMany(loans, engineEnv(tenant), { mode: 'fast', concurrency: 6 });
        await audit(tenant, { request_id: reqId, endpoint: 'portfolio_audit', n: loans.length, at: new Date().toISOString() });
        return send({ ...portfolioAudit(results), results: results.map(slimResult) }, 200, H);
      }
      if (path === '/v1/pulse/subscriptions' && req.method === 'POST') {
        const b = await req.json();
        if (!b.asset || b.asset.lat == null) return fail(400, 'bad_request', 'asset {lat, lon, asset_type} required', H);
        const id = 'sub_' + reqId.slice(4);
        const sub = { id, asset: b.asset, webhook_url: b.webhook_url || null, cadence: b.cadence || 'monthly', created_at: new Date().toISOString() };
        sub.last_snapshot = await pulseSnapshot({ ...b.asset, asset_id: id }, engineEnv(tenant)).catch(() => null);
        await store.put(`sub:${tenant.id}:${id}`, sub);
        return send(sub, 201, H);
      }
      if (path === '/v1/pulse/subscriptions' && req.method === 'GET') return send({ data: (await store.list(`sub:${tenant.id}:`)).map((x) => x.value) }, 200, H);
      if ((m = path.match(/^\/v1\/pulse\/subscriptions\/(sub_\w+)$/)) && req.method === 'DELETE') { await store.delete(`sub:${tenant.id}:${m[1]}`); return send({ deleted: m[1] }, 200, H); }
      if (path === '/v1/pulse/run' && req.method === 'POST') return send({ ran: await runPulse(tenant) }, 200, H);
      if (path === '/v1/audit-log') return send({ data: (await store.list(`audit:${tenant.id}:`, +(url.searchParams.get('limit') || 100))).map((x) => x.value).reverse() }, 200, H);
      return fail(404, 'not_found', `No route for ${req.method} ${path}`, H);
    } catch (e) {
      return fail(e.status || 500, e.status === 400 ? 'bad_request' : 'internal_error', String(e.message || e), H);
    }
  }

  async function runAllPulse() {
    const tenants = await store.list('tenant:');
    const out = [];
    for (const { value: t } of tenants) out.push({ tenant: t.id, results: await runPulse(t) });
    return out;
  }

  return { handle, runAllPulse };
}

export function slimResult(r) {
  if (!r || r.error) return r;
  return { id: r.id, reference_id: r.reference_id, input: r.input, location: r.location, score: r.score, valuation: r.valuation, liquidity: r.liquidity, hazards: r.hazards, lending: r.lending, flags: r.flags, decision: r.decision, sources_ok: r.provenance.live_sources_ok };
}
