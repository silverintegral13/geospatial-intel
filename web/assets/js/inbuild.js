// "In build": features planned after the core NBFC valuation product. None of them is part of the
// product an NBFC buys today. Each page says what the feature will do, when we plan to launch it,
// what has to be true before we do, and how far the build has got.
import { bus } from './state.js';
import { renderBranch } from './branch.js';

const $ = (s) => document.querySelector(s);

export const IN_BUILD = [
  {
    id: 'pulse', name: 'Pulse', launch: 'H2 2028', progress: 45,
    tagline: 'Monthly re-check of every financed property from orbit',
    what: 'Every property in an NBFC’s book is re-checked each month from satellites: night lights for shops and factories, crop vigour for farmland, river-flood forecasts for everything. When something changes, the collections team gets an alert before repayments slip.',
    who: 'Collections and portfolio-monitoring teams at NBFCs already using the valuation report.',
    when: 'Second half of 2028, once the valuation report is live at 10 or more NBFCs.',
    gate: ['Back-tests on 3 customer loan books show alerts arriving 60+ days before 30+ days past due', 'At least 60% of alerts confirmed by field teams', '3 NBFCs commit at ₹10+ per asset a month'],
    status: [['Signals', 'Night lights, NDVI, flood forecast wired', 'ok'], ['Change detection', 'Prototype on sample assets', 'ok'], ['Alert calibration', 'Needs customer outcomes', 'wip'], ['Webhooks to collections', 'Designed', 'wip']],
    preview: true,
  },
  {
    id: 'investor', name: 'Investor Lens', launch: 'H1 2029', progress: 25,
    tagline: 'A collateral certificate for a whole loan book',
    what: 'A co-lending bank, pool buyer or equity investor uploads a loan tape and gets one certificate for the book: realisable cover (what the collateral would fetch versus what is owed), the share of loans under-covered, concentration by district and hazard, and stress tests such as a 20% price fall or a flood year.',
    who: 'Banks that co-lend with NBFCs, buyers of securitised loan pools, and investors diligencing a lender.',
    when: 'First half of 2029, once 10 or more NBFC loan books run on our engine.',
    gate: ['2 or more co-lenders or pool buyers ask for it in live deals', 'Originating NBFCs consent to sharing their book-level results', 'Buyers will pay at least ₹8 lakh a year'],
    status: [['Book re-valuation (input)', 'Live in Portfolio', 'ok'], ['Certificate design', 'Drafted', 'wip'], ['Stress-test library', 'Designed', 'wip'], ['Consent and data-sharing terms', 'Not started', 'todo']],
  },
  {
    id: 'branch', name: 'Branch Intelligence', launch: 'H2 2029', progress: 35,
    tagline: 'Where an NBFC should open its next branch',
    what: 'Scores every candidate town in a state on the demand in its catchment, competitor branches and the quality of the collateral nearby, and explains why an existing branch underperforms.',
    who: 'NBFC strategy and expansion teams opening 20 or more branches a year.',
    when: 'Second half of 2029, after Investor Lens.',
    gate: ['3 or more customers opening 20+ branches a year ask for it', 'In back-tests, top-ranked catchments beat others by 15%+ on disbursals and delinquency', 'It reuses 70%+ of our existing data pipes'],
    status: [['Method', 'Designed', 'ok'], ['Data signals', '7 of 9 in our data fabric', 'ok'], ['Scoring engine', 'Building', 'wip'], ['Competitor-branch connector', 'Needs licence', 'todo']],
    detail: true,
  },
];

const mark = { ok: '●', wip: '◐', todo: '○' };

export function renderInBuild(id) {
  const f = IN_BUILD.find((x) => x.id === id);
  if (!f) return hub();
  if (f.id === 'branch' && f.detail && id === 'branch') { renderBranch(); addBack(); return; }
  detail(f);
}

function hub() {
  const el = $('#panelInner');
  el.innerHTML = `
  <div class="ph"><div><div class="kicker">IN BUILD <span class="soon">NOT YET LAUNCHED</span></div><h2>What comes after the core</h2><p>Today BhoomiPulse does one thing for one customer: asset valuation for NBFCs. These three features reuse the same engine and data. Each has a planned launch date and a test it must pass first; none is in our financial plan.</p></div></div>
  <div class="ibroad">${IN_BUILD.map((f) => `<div><b>${f.launch}</b><span>${f.name}</span></div>`).join('')}</div>
  ${IN_BUILD.map((f) => `
  <div class="sec ibcard">
    <h3>${f.name} <small><span class="soon">IN BUILD</span> launch ${f.launch}</small></h3>
    <p class="hint" style="margin-top:0">${f.tagline}.</p>
    <div class="ibbar"><i style="width:${f.progress}%"></i></div><small class="ibp">Build progress about ${f.progress}%</small>
    <div class="btns"><button class="btn" data-ib="${f.id}">Details, launch test and status →</button></div>
  </div>`).join('')}`;
  el.querySelectorAll('[data-ib]').forEach((b) => (b.onclick = () => renderInBuild(b.dataset.ib)));
}

function detail(f) {
  const el = $('#panelInner');
  el.innerHTML = `
  <div class="ph"><div><div class="kicker">${f.name.toUpperCase()} <span class="soon">IN BUILD</span></div><h2>${f.tagline}</h2><p>${f.what}</p></div></div>
  <div class="wip"><b>Not part of the product today.</b> Planned launch: ${f.launch}. It ships only if the launch test below is met.</div>
  <div class="sec"><h3>Who it is for</h3><p class="hint" style="margin-top:0">${f.who}</p></div>
  <div class="sec"><h3>When</h3><p class="hint" style="margin-top:0">${f.when}</p></div>
  <div class="sec"><h3>Launch test <small>all must be true</small></h3><ol class="steps4">${f.gate.map((g) => `<li>${g}</li>`).join('')}</ol></div>
  <div class="sec"><h3>Build status <small>● done · ◐ in progress · ○ not started</small></h3>
    ${f.status.map(([k, v, st]) => `<div class="conn"><b>${k}</b><span class="s ${st === 'ok' ? 'st-ok' : 'lock'}">${mark[st]} ${st === 'ok' ? 'done' : st === 'wip' ? 'in progress' : 'not started'}</span><small>${v}</small></div>`).join('')}
    <div class="ibbar" style="margin-top:10px"><i style="width:${f.progress}%"></i></div><small class="ibp">Build progress about ${f.progress}%</small>
  </div>
  <div class="btns" style="margin-top:12px"><button class="btn" id="ibBack">← All in-build features</button>${f.preview ? '<button class="btn" id="ibPreview">Open the early prototype</button>' : ''}</div>`;
  $('#ibBack').onclick = () => renderInBuild();
  if (f.preview) $('#ibPreview').onclick = () => bus.emit('mode', f.id);
}

function addBack() {
  const el = $('#panelInner');
  const b = Object.assign(document.createElement('div'), { className: 'btns', innerHTML: '<button class="btn" id="ibBack">← All in-build features</button>' });
  b.style.marginTop = '12px'; el.appendChild(b);
  $('#ibBack').onclick = () => renderInBuild();
}
