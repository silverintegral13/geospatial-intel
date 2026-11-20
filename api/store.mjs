// Storage adapters with one interface: get, put(key, value, {ttl}), delete, list(prefix, limit) -> [{key, value}].
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export class MemoryStore {
  constructor() { this.m = new Map(); }
  _alive(k) { const v = this.m.get(k); if (!v) return null; if (v.exp && v.exp < Date.now()) { this.m.delete(k); return null; } return v; }
  async get(k) { return this._alive(k)?.v ?? null; }
  async put(k, v, { ttl } = {}) { this.m.set(k, { v: structuredClone(v), exp: ttl ? Date.now() + ttl * 1000 : 0 }); }
  async delete(k) { this.m.delete(k); }
  async list(prefix, limit = 1000) { const out = []; for (const k of [...this.m.keys()].sort()) { if (k.startsWith(prefix) && this._alive(k)) out.push({ key: k, value: this.m.get(k).v }); if (out.length >= limit) break; } return out; }
}

// Persists to a JSON file (single-node on-prem deployments). Swap for Redis/Postgres at scale.
export class FileStore extends MemoryStore {
  constructor(path) { super(); this.path = path; if (existsSync(path)) { try { this.m = new Map(Object.entries(JSON.parse(readFileSync(path, 'utf8')))); } catch { /* start empty */ } } this._t = null; }
  _flush() { clearTimeout(this._t); this._t = setTimeout(() => { mkdirSync(dirname(this.path), { recursive: true }); writeFileSync(this.path, JSON.stringify(Object.fromEntries(this.m))); }, 250); }
  async put(k, v, o) { await super.put(k, v, o); if (!k.startsWith('rl:')) this._flush(); }
  async delete(k) { await super.delete(k); this._flush(); }
}
