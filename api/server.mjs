// Node 18+ server for on-prem / VPC / Docker deployments (data never leaves the lender's network except
// for the public-data calls). Same handler as the Cloudflare Worker.
//   PORT=8787 ADMIN_TOKEN=... DEMO_KEY=bp_demo_123 node api/server.mjs
//   MOCK=1 runs fully offline on simulated upstreams.
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHandler } from './handler.mjs';
import { MemoryStore, FileStore } from './store.mjs';
import { makeDistrictLookup } from '../web/engine/geo.js';
import { mockFetch, setPngEncoder } from '../web/engine/mock.js';
import { encodePng } from '../web/engine/vendor/imgdecode.js';

const here = dirname(fileURLToPath(import.meta.url));
const env = { ...process.env };
const store = env.STORE_PATH ? new FileStore(env.STORE_PATH) : new MemoryStore();
let fetchFn = globalThis.fetch;
if (env.MOCK === '1') { setPngEncoder(encodePng); fetchFn = mockFetch(); console.log('MOCK=1: simulated upstreams'); }
const districtLookup = makeDistrictLookup(JSON.parse(readFileSync(join(here, '../web/data/india_districts.geojson'), 'utf8')));
const api = createHandler({ store, env, fetch: fetchFn, webhookFetch: globalThis.fetch, districtLookup });

const server = http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const request = new Request(`http://${req.headers.host || 'localhost'}${req.url}`, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body });
  const pending = [];
  const r = await api.handle(request, { waitUntil: (p) => pending.push(p) });
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
});
const port = +(env.PORT || 8787);
server.listen(port, () => console.log(`BhoomiPulse API on http://localhost:${port}  (docs: /docs)`));

// Pulse scheduler: re-check monitored assets every PULSE_INTERVAL_HOURS (default 24; each subscription is
// refreshed on its cadence by the handler's snapshot history).
const hours = +(env.PULSE_INTERVAL_HOURS || 24);
setInterval(() => api.runAllPulse().catch((e) => console.error('pulse', e)), hours * 3600 * 1000).unref();
export default server;
