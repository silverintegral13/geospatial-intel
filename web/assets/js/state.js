// Shared app state + a tiny event bus.
export const S = {
  mode: 'assess', tool: null, asset: null, assetType: 'residential', epoch: '2016-01-01', globe: true, offline: false,
  sparkleIntensity: 1, cities: [], districtsFC: null, lastResult: null, portfolio: [], portfolioResults: [], watch: [],
  tenant: 'default',
  layers: { sparkle: true, blackmarble: true, roads: true, buildings: true, satellite: false, ndvi: false, flood: false, s2scene: false, districts: true, portfolio: true, watch: true },
};
const handlers = {};
export const bus = {
  on(e, f) { (handlers[e] ||= []).push(f); },
  emit(e, ...a) { (handlers[e] || []).forEach((f) => { try { f(...a); } catch (err) { console.error(e, err); } }); },
};
export const store = {
  get(k, d) { try { const v = localStorage.getItem('bp:' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('bp:' + k, JSON.stringify(v)); } catch { /* private mode */ } },
};
