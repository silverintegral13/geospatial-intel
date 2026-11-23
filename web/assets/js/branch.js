// Branch Intelligence: a preview of a module that is being built. It is deliberately NOT wired to the
// assessment engine: no scores are computed here. It shows the method, the signals and the roadmap.
import { fitTo, toast } from './map.js';

const $ = (s) => document.querySelector(s);

const SIGNALS = [
  ['Households in catchment', 'Demand: how many potential borrowers live within 25 km', 'OSM buildings + built-up area', 'today'],
  ['Built-up growth', 'Is the area developing? Change in built-up land over the last decade', 'ESA WorldCover · IO land use 2017–23', 'today'],
  ['Shop density', 'Commercial depth for micro-enterprise loans', 'OpenStreetMap shops and amenities', 'today'],
  ['Minor-road density', 'Can borrowers and field staff reach the branch, all year?', 'OpenStreetMap road network', 'today'],
  ['Canals and irrigation', 'Reliable water means steadier farm income', 'OSM waterways + JRC surface water', 'today'],
  ['Farm potential', 'Slope, water and crop vigour across the catchment', 'Copernicus DEM + Sentinel-2 NDVI', 'today'],
  ['Night-light growth', 'Economic activity trend, a proxy for affluence', 'NASA VIIRS', 'today'],
  ['Competitor branches', 'White space against banks, MFIs, SFBs and co-ops', 'RBI branch list + lender data', 'connector'],
  ['Credit bureau depth', 'Existing borrowers and delinquency by area', 'Bureau aggregates under licence', 'connector'],
];

export function renderBranch() {
  const el = $('#panelInner');
  el.innerHTML = `
  <div class="ph"><div><div class="kicker">BRANCH INTELLIGENCE <span class="soon">IN BUILD</span></div><h2>Where should a lender open its next branch?</h2><p>The same public-data fabric that values a single asset can score a whole catchment. Branch Intelligence ranks every candidate town for a lender's next branch, and explains why an existing branch is underperforming.</p></div></div>
  <div class="wip"><b>In build, planned launch H2 2029.</b> It is not connected to the assessment engine and shows no live scores yet. It launches only if 3+ NBFCs opening 20+ branches a year ask for it and back-tested top catchments beat others by 15%+.</div>
  <div class="sec"><h3>Build status</h3>
    <div class="kpis">
      <div class="kpi"><span>Method</span><b class="cyan">Designed</b></div>
      <div class="kpi"><span>Data signals</span><b class="cyan">7 of 9 in fabric</b></div>
      <div class="kpi"><span>Scoring engine</span><b class="amber">Building</b></div>
    </div>
  </div>
  <div class="sec"><h3>How it will work</h3>
    <ol class="steps4">
      <li><b>Candidate points.</b> Every taluka headquarters in a state, minus district HQs, which distort their neighbours.</li>
      <li><b>Catchment.</b> A 25 km radius around each candidate, the distance a borrower will travel to a branch.</li>
      <li><b>Filters, then scores.</b> Drop towns below minimum demand, development and road access, or with an existing branch; score the rest from 0 to 10.</li>
      <li><b>Two ratings.</b> A business rating for micro-enterprise loans and an agriculture rating for farm loans, because the two books want different towns.</li>
      <li><b>Diagnose the network.</b> Rate existing branches the same way and name the weakest factor behind each underperformer.</li>
    </ol>
  </div>
  <div class="sec"><h3>Signals per catchment <small>● in our fabric today · ◌ needs a connector</small></h3>
    ${SIGNALS.map(([n, why, src, st]) => `<div class="conn"><b>${n}</b><span class="s ${st === 'today' ? 'st-ok' : 'lock'}">${st === 'today' ? '● today' : '◌ connector'}</span><small>${why} · ${src}</small></div>`).join('')}
  </div>
  <div class="sec"><h3>Starting weights <small>learned from branch outcomes once live</small></h3>
    <div class="wgrid">
      <div><h4>Business rating</h4>${bar('Shop density', 40)}${bar('Built-up growth', 30)}${bar('Households', 10)}${bar('Minor roads', 10)}${bar('Affluence proxy', 10)}</div>
      <div><h4>Agriculture rating</h4>${bar('Households', 40)}${bar('Farm potential', 40)}${bar('Canals', 10)}${bar('Minor roads', 10)}</div>
    </div>
    <p class="hint">Starting priors reflect market research on how branch-siting models in this space are weighted. BhoomiPulse replaces them with weights fitted to each lender's own branch disbursals and delinquency, the same way we learn collateral weights from recoveries.</p>
  </div>
  <div class="sec"><h3>Why it belongs in BhoomiPulse</h3>
    <p class="hint" style="margin-top:0">Same data, same catchment maths, same API. A lender that knows which catchments grow, flood or dim can open branches where its collateral will also hold value.</p>
    <div class="btns"><button class="btn pri" id="branchPilot">Join the design-partner pilot</button><button class="btn" id="branchMap">Show Maharashtra</button></div>
  </div>`;
  $('#branchPilot').onclick = () => toast('Thanks. Branch Intelligence is planned for H2 2029; we will reach out when design-partner pilots open.', 4200);
  $('#branchMap').onclick = () => fitTo([{ lon: 72.6, lat: 15.6 }, { lon: 80.9, lat: 22.1 }]);
}

function bar(label, w) {
  return `<div class="wrow"><span>${label}</span><i><em style="width:${w * 2.2}%"></em></i><b>${w}%</b></div>`;
}
