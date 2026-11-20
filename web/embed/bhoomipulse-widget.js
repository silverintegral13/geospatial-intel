// <bhoomipulse-card> — drop-in widget for a lender's LOS / CRM screen.
//   <script type="module" src="https://<host>/embed/bhoomipulse-widget.js"></script>
//   <bhoomipulse-card api="https://api.example" key="bp_live_..." lat="22.99" lon="72.37" asset-type="residential" built-up-sqft="1100" loan-amount="3500000"></bhoomipulse-card>
// Use a short-lived, origin-restricted key in the browser, or point `api` at your own backend proxy.
const css = `:host{display:block;font:14px/1.45 Inter,system-ui,sans-serif;color:#e8eefc}
.c{background:linear-gradient(160deg,#0b1222,#060912);border:1px solid #1f2c4a;border-radius:14px;padding:16px 18px;max-width:420px}
.h{display:flex;justify-content:space-between;align-items:center}.g{font:700 34px/1 'Space Grotesk',Inter,sans-serif;color:#ffc861}
.s{color:#8ea0c8;font-size:12px}.row{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}
.k{background:#0e1830;border-radius:10px;padding:8px 10px}.k b{display:block;font-size:15px}.k span{font-size:11.5px;color:#8ea0c8}
.f{margin-top:10px;font-size:12.5px}.f div{padding:4px 8px;border-left:3px solid #ff5d73;margin:4px 0;background:#ff5d7312}
.r{margin-top:10px;font-weight:600;color:#64e3ff}.err{color:#ff8a9a}`;
const inr = (x) => x >= 1e7 ? '₹' + (x / 1e7).toFixed(2) + ' Cr' : '₹' + (x / 1e5).toFixed(1) + ' L';
class BhoomiPulseCard extends HTMLElement {
  static get observedAttributes() { return ['lat', 'lon', 'asset-type']; }
  connectedCallback() { this.attachShadow({ mode: 'open' }); this.run(); }
  attributeChangedCallback() { if (this.shadowRoot) this.run(); }
  async run() {
    const a = (k) => this.getAttribute(k);
    this.shadowRoot.innerHTML = `<style>${css}</style><div class="c"><div class="s">BhoomiPulse · assessing…</div></div>`;
    try {
      const body = { lat: +a('lat'), lon: +a('lon'), asset_type: a('asset-type') || 'residential', reference_id: a('reference-id') || undefined };
      for (const [attr, key] of [['area-sqm', 'area_sqm'], ['built-up-sqft', 'built_up_sqft'], ['loan-amount', 'loan_amount'], ['declared-value', 'declared_value']]) if (a(attr)) body[key] = +a(attr);
      const r = await (await fetch(a('api').replace(/\/$/, '') + '/v1/assess', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + a('key') }, body: JSON.stringify(body) })).json();
      if (r.error) throw new Error(r.error.message);
      this.shadowRoot.querySelector('.c').innerHTML = `<div class="h"><div><div class="s">Collateral quality</div><div class="g">${r.score.grade} <small style="font-size:14px;color:#8ea0c8">${r.score.cqs}/100</small></div></div><div class="s" style="text-align:right">${r.location.district || ''}<br>${r.location.state || ''}</div></div>
      <div class="row"><div class="k"><span>Value (P50)</span><b>${inr(r.valuation.p50)}</b></div><div class="k"><span>80% range</span><b>${inr(r.valuation.p10)}–${inr(r.valuation.p90)}</b></div>
      <div class="k"><span>Recommended LTV</span><b>${Math.round(r.lending.recommended_ltv * 100)}%</b></div><div class="k"><span>Realisable</span><b>${inr(r.liquidity.realisable_value)}</b></div></div>
      <div class="f">${r.flags.filter((f) => f.severity !== 'low').map((f) => `<div>${f.text}</div>`).join('')}</div><div class="r">${r.decision.label}</div>`;
      this.dispatchEvent(new CustomEvent('assessed', { detail: r, bubbles: true }));
    } catch (e) { this.shadowRoot.querySelector('.c').innerHTML = `<div class="err">BhoomiPulse: ${e.message}</div>`; }
  }
}
customElements.define('bhoomipulse-card', BhoomiPulseCard);
