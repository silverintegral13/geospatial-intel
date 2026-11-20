// Cloudflare Workers KV adapter (no Node imports, safe to bundle into the Worker).
export class KVStore {
  constructor(kv) { this.kv = kv; }
  async get(k) { return this.kv.get(k, 'json'); }
  async put(k, v, { ttl } = {}) { await this.kv.put(k, JSON.stringify(v), ttl ? { expirationTtl: Math.max(60, ttl) } : undefined); }
  async delete(k) { await this.kv.delete(k); }
  async list(prefix, limit = 1000) {
    const out = []; let cursor;
    do {
      const r = await this.kv.list({ prefix, cursor, limit: Math.min(1000, limit - out.length) });
      for (const { name } of r.keys) { const value = await this.get(name); if (value != null) out.push({ key: name, value }); }
      cursor = r.list_complete ? null : r.cursor;
    } while (cursor && out.length < limit);
    return out;
  }
}
