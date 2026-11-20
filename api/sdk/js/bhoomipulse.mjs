// Minimal JS/TS client (browser, Node 18+, Workers).
export class BhoomiPulse {
  constructor(baseUrl, apiKey) { this.base = baseUrl.replace(/\/$/, ''); this.key = apiKey; }
  async #req(method, path, body, headers = {}) {
    const r = await fetch(this.base + path, { method, headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
    const t = r.headers.get('content-type') || '';
    const out = t.includes('json') ? await r.json() : await r.text();
    if (!r.ok) throw Object.assign(new Error(out?.error?.message || r.statusText), { status: r.status, body: out });
    return out;
  }
  assess(asset, { idempotencyKey } = {}) { return this.#req('POST', '/v1/assess', asset, idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}); }
  report(id) { return this.#req('GET', `/v1/assessments/${id}/report`); }
  async batch(assets, { mode = 'fast', webhookUrl, wait = true } = {}) {
    let job = await this.#req('POST', '/v1/batch', { assets, mode, webhook_url: webhookUrl });
    while (wait && !['completed', 'failed'].includes(job.status)) { await new Promise((r) => setTimeout(r, 3000)); job = await this.#req('GET', `/v1/jobs/${job.id}`); }
    return job;
  }
  portfolioAudit(loans) { return this.#req('POST', '/v1/portfolio/audit', { loans }); }
  monitor(asset, { webhookUrl, cadence = 'monthly' } = {}) { return this.#req('POST', '/v1/pulse/subscriptions', { asset, webhook_url: webhookUrl, cadence }); }
}
export async function verifyWebhook(secret, header, rawBody) {
  const p = Object.fromEntries(header.split(',').map((x) => x.split('=')));
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = [...new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(`${p.t}.${rawBody}`)))].map((b) => b.toString(16).padStart(2, '0')).join('');
  return sig === p.v1 && Math.abs(Date.now() / 1000 - +p.t) < 300;
}
