// Small SVG chart helpers sized to their container (drawn at real pixel size, redrawn on resize).
const NS = 'http://www.w3.org/2000/svg';
export function mount(el, draw) {
  const svg = document.createElementNS(NS, 'svg'); el.appendChild(svg);
  const run = () => { const W = el.clientWidth, H = el.clientHeight; if (!W) return; svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.innerHTML = draw(W, H); };
  const ro = new ResizeObserver(run); ro.observe(el); run();
  return svg;
}
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
export function line(el, pts, { color = '#5ce1ff', fill = true, yMin, yMax, labels = true, unit = '', hollow = () => false, ref } = {}) {
  return mount(el, (W, H) => {
    if (!pts.length) return `<text x="8" y="${H / 2}" fill="#71809f" font-size="11">No data</text>`;
    const ys = pts.map((p) => p[1]); const lo = yMin ?? Math.min(...ys), hi = yMax ?? Math.max(...ys);
    const pad = { l: 4, r: 4, t: 12, b: labels ? 16 : 4 };
    const X = (i) => pad.l + (W - pad.l - pad.r) * (pts.length === 1 ? 0.5 : i / (pts.length - 1));
    const Y = (v) => pad.t + (H - pad.t - pad.b) * (1 - (v - lo) / ((hi - lo) || 1));
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('');
    const id = 'g' + Math.random().toString(36).slice(2, 7);
    let s = `<defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".35"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>`;
    if (ref != null) s += `<line x1="0" x2="${W}" y1="${Y(ref)}" y2="${Y(ref)}" stroke="#ffffff22" stroke-dasharray="3 3"/>`;
    if (fill) s += `<path d="${d}L${X(pts.length - 1)},${H - pad.b}L${X(0)},${H - pad.b}Z" fill="url(#${id})"/>`;
    s += `<path d="${d}" stroke="${color}" stroke-width="1.8" fill="none"/>`;
    pts.forEach((p, i) => { s += `<circle cx="${X(i)}" cy="${Y(p[1])}" r="${hollow(p) ? 2.6 : 2.4}" fill="${hollow(p) ? '#02040a' : color}" stroke="${color}" stroke-width="1.2"><title>${esc(p[0])}: ${p[1]}${unit}</title></circle>`; });
    if (labels) {
      const show = W < 300 ? [0, pts.length - 1] : [0, Math.floor(pts.length / 2), pts.length - 1];
      [...new Set(show)].forEach((i) => { s += `<text x="${X(i)}" y="${H - 3}" fill="#71809f" font-size="10" text-anchor="${i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'middle'}" font-family="JetBrains Mono">${esc(String(pts[i][0]).slice(0, 7))}</text>`; });
      s += `<text x="${W - 2}" y="10" fill="#a9b6d3" font-size="10" text-anchor="end" font-family="JetBrains Mono">max ${Math.round(hi * 100) / 100}${unit}</text>`;
    }
    return s;
  });
}
export function bars(el, items, { color = '#ffb547', unit = '' } = {}) {
  return mount(el, (W, H) => {
    if (!items.length) return '';
    const hi = Math.max(...items.map((x) => x[1])) || 1, bw = (W - 4) / items.length;
    return items.map(([k, v, hl], i) => { const h = (H - 18) * v / hi; return `<rect x="${2 + i * bw + 1}" y="${H - 14 - h}" width="${Math.max(1, bw - 3)}" height="${h}" rx="2" fill="${hl ? '#ff5470' : color}" opacity=".85"><title>${esc(k)}: ${v}${unit}</title></rect>${W > 260 || i % 2 === 0 ? `<text x="${2 + i * bw + bw / 2}" y="${H - 2}" fill="#71809f" font-size="9.5" text-anchor="middle" font-family="JetBrains Mono">${esc(String(k).slice(-2))}</text>` : ''}`; }).join('');
  });
}
export function radar(el, entries) {
  return mount(el, (W, H) => {
    const cx = W / 2, cy = H / 2 + 4, R = Math.min(W, H) / 2 - 26, n = entries.length;
    const P = (i, r) => [cx + r * Math.sin((2 * Math.PI * i) / n), cy - r * Math.cos((2 * Math.PI * i) / n)];
    let s = '';
    for (const f of [0.25, 0.5, 0.75, 1]) s += `<polygon points="${entries.map((_, i) => P(i, R * f).join(',')).join(' ')}" fill="none" stroke="#ffffff14"/>`;
    entries.forEach((_, i) => { const [x, y] = P(i, R); s += `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="#ffffff10"/>`; });
    s += `<polygon points="${entries.map(([, v], i) => P(i, R * (v ?? 0) / 100).join(',')).join(' ')}" fill="#ffb54733" stroke="#ffb547" stroke-width="1.6"/>`;
    entries.forEach(([k, v], i) => { const [x, y] = P(i, R + 14); s += `<text x="${x}" y="${y + 3}" fill="#a9b6d3" font-size="10.5" text-anchor="middle">${esc(k)} <tspan fill="#ffd98a" font-family="JetBrains Mono">${v ?? '–'}</tspan></text>`; });
    return s;
  });
}
export function dial(score, grade) {
  const r = 56, c = 2 * Math.PI * r, f = Math.max(0, Math.min(1, score / 100));
  const col = { A: '#3ee08f', B: '#a6e36b', C: '#ffd166', D: '#ff9a3d', E: '#ff5470' }[grade] || '#ffb547';
  return `<div class="dial"><svg viewBox="0 0 132 132"><defs><linearGradient id="dg" x1="0" x2="1"><stop offset="0" stop-color="#ffb547"/><stop offset="1" stop-color="${col}"/></linearGradient></defs>
  <circle cx="66" cy="66" r="${r}" stroke="#ffffff12" stroke-width="9"/>
  <circle cx="66" cy="66" r="${r}" stroke="url(#dg)" stroke-width="9" stroke-dasharray="${c}" stroke-dashoffset="${c}" style="transition:stroke-dashoffset 1.4s cubic-bezier(.2,.8,.2,1);filter:drop-shadow(0 0 6px ${col})" data-target="${c * (1 - f)}"/>
  ${Array.from({ length: 40 }, (_, i) => { const a = (i / 40) * 2 * Math.PI; return `<line x1="${66 + 64 * Math.cos(a)}" y1="${66 + 64 * Math.sin(a)}" x2="${66 + 61 * Math.cos(a)}" y2="${66 + 61 * Math.sin(a)}" stroke="#ffffff22"/>`; }).join('')}
  </svg><div class="g"><div><b style="color:${col}">${grade}</b><small>${score}/100</small></div></div></div>`;
}
export function animateDials(root) { requestAnimationFrame(() => root.querySelectorAll('[data-target]').forEach((c) => (c.style.strokeDashoffset = c.dataset.target))); }
