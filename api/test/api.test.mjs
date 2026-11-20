import assert from 'node:assert/strict';
import { createHandler } from '../handler.mjs';
import { MemoryStore } from '../store.mjs';
import { mockFetch, setPngEncoder } from '../../web/engine/mock.js';
import { encodePng } from '../../web/engine/vendor/imgdecode.js';
import { makeDistrictLookup } from '../../web/engine/geo.js';
import { readFileSync } from 'node:fs';
setPngEncoder(encodePng);
const hooks = [];
const api = createHandler({
  store: new MemoryStore(), env: { ADMIN_TOKEN: 'adm', DEMO_KEY: 'bp_demo' }, fetch: mockFetch(),
  webhookFetch: async (url, init) => { hooks.push({ url, init }); return new Response('ok'); },
  districtLookup: makeDistrictLookup(JSON.parse(readFileSync(new URL('../../web/data/india_districts.geojson', import.meta.url)))),
});
const call = async (method, path, body, headers = {}) => {
  const r = await api.handle(new Request('http://x' + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined }), { waitUntil: (p) => p });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, body: j, headers: r.headers };
};
assert.equal((await call('GET', '/v1/health')).status, 200);
assert.equal((await call('POST', '/v1/assess', { lat: 1, lon: 2 })).status, 401);
const t = await call('POST', '/v1/admin/tenants', { name: 'Acme Housing Finance', policy: { ltv_caps: { residential: 0.7 }, el_threshold: 0.015 } }, { 'X-Admin-Token': 'adm' });
assert.equal(t.status, 201); const KEY = { Authorization: 'Bearer ' + t.body.api_key };
console.log('tenant', t.body.tenant.id, t.body.api_key.slice(0, 14) + '…');
const a = await call('POST', '/v1/assess', { reference_id: 'LAP-1', lat: 23.0225, lon: 72.5714, asset_type: 'residential', built_up_sqft: 1100, loan_amount: 3500000 }, { ...KEY, 'Idempotency-Key': 'k1' });
assert.equal(a.status, 200); console.log('assess', a.body.score, a.body.lending.recommended_ltv, a.body.location, a.headers.get('x-model-version'));
assert.ok(a.body.lending.recommended_ltv <= 0.7, 'tenant LTV cap applied');
const a2 = await call('POST', '/v1/assess', { lat: 0, lon: 0 }, { ...KEY, 'Idempotency-Key': 'k1' });
assert.equal(a2.body.id, a.body.id); assert.equal(a2.headers.get('idempotent-replay'), 'true');
const rep = await call('GET', `/v1/assessments/${a.body.id}/report`, null, KEY);
assert.equal(rep.status, 200); assert.ok(String(rep.body).includes('collateral report'));
const loans = Array.from({ length: 30 }, (_, i) => ({ reference_id: 'L' + i, lat: 18.4 + (i % 6) * 0.08, lon: 73.7 + Math.floor(i / 6) * 0.07, asset_type: ['residential', 'commercial', 'plot'][i % 3], loan_amount: 1e6 + i * 2e5, area_sqm: 120, built_up_sqft: 900 }));
const b = await call('POST', '/v1/batch', { assets: loans.slice(0, 8) }, KEY);
assert.equal(b.status, 200); console.log('sync batch', b.body.status, b.body.audit.book_grade, b.body.audit.concentration.top_district);
const q = await call('POST', '/v1/batch', { assets: loans, webhook_url: 'https://lender.example/hooks' }, KEY);
assert.equal(q.status, 202);
let job; for (let i = 0; i < 100; i++) { job = (await call('GET', q.body.poll, null, KEY)).body; if (job.status === 'completed') break; await new Promise((r) => setTimeout(r, 200)); }
assert.equal(job.status, 'completed'); console.log('async batch', job.done, job.audit.exposure_weighted_cqs, 'webhooks', hooks.length);
const audit = await call('POST', '/v1/portfolio/audit', { loans: loans.slice(0, 12) }, KEY);
console.log('audit', audit.body.book_grade, audit.body.grade_mix, audit.body.el_rate);
const sub = await call('POST', '/v1/pulse/subscriptions', { asset: { lat: 22.889, lon: 72.223, asset_type: 'agri_land' }, webhook_url: 'https://lender.example/pulse' }, KEY);
assert.equal(sub.status, 201); console.log('sub', sub.body.id, sub.body.last_snapshot.activity_index);
const run = await call('POST', '/v1/pulse/run', {}, KEY); console.log('pulse run', JSON.stringify(run.body));
const log = await call('GET', '/v1/audit-log', null, KEY); console.log('audit log entries', log.body.data.length);
const demo = await call('GET', '/v1/tenant', null, { Authorization: 'Bearer bp_demo' }); assert.equal(demo.body.id, 'demo');
const docs = await call('GET', '/openapi.json'); assert.ok(docs.body.paths['/v1/assess']);
console.log('API OK');
