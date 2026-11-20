// Cloudflare Worker entry. Deploy with `npx wrangler deploy` from /api (see api/README.md).
import { createHandler } from './handler.mjs';
import { KVStore } from './kvstore.js';
import { makeDistrictLookup } from '../web/engine/geo.js';

let lookup = null;
async function districts(env) {
  if (lookup || !env.DISTRICTS_URL) return lookup;
  try { lookup = makeDistrictLookup(await (await fetch(env.DISTRICTS_URL)).json()); } catch { /* optional */ }
  return lookup;
}

export default {
  async fetch(request, env, ctx) {
    const api = createHandler({ store: new KVStore(env.BP_KV), env, districtLookup: await districts(env) });
    return api.handle(request, ctx);
  },
  async scheduled(event, env, ctx) {
    const api = createHandler({ store: new KVStore(env.BP_KV), env, districtLookup: await districts(env) });
    ctx.waitUntil(api.runAllPulse());
  },
};
