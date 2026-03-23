import { useState, useEffect, useRef } from "react";

// ─── CONFIG GOOGLE SHEETS ─────────────────────────────────────────────────────
const SHEET_ID    = "1Mp8SVYlWw-P6z0ty_JuBEhZtpzqUzMYtBuO9z0knZ4I";
const GID_MASTER  = "377128355";
const GID_HISTORY = "1449053835";
const csvUrl = (gid) =>
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`;

// ─── KAITO (status uniquement — calculs faits par Claude MCP) ────────────────
async function fetchKaitoStatus() {
  try {
    const res = await fetch("/api/kaito?type=status");
    if (!res.ok) return { enabled: false };
    return await res.json();
  } catch { return { enabled: false }; }
}

async function fetchKaitoMindshare() {
  try {
    const res = await fetch("/api/kaito?type=mindshare");
    if (!res.ok) return null;
    return await res.json(); // { value, unit, week, detail: { breakdown: [{token, value}] } }
  } catch { return null; }
}


// ─── AIRTABLE ─────────────────────────────────────────────────────────────────
async function fetchAirtableData() {
  try {
    const res = await fetch("/api/airtable");
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

// ─── COINGECKO ────────────────────────────────────────────────────────────────
const TOKENS = [
  { id: "iexec-rlc",    symbol: "RLC",  name: "iExec RLC", color: "#FCD15A", isMain: true  },
  { id: "oasis-network", symbol: "ROSE", name: "Oasis",     color: "#8B5CF6", isMain: false },
  { id: "secret",        symbol: "SCRT", name: "Secret",    color: "#10B981", isMain: false },
  { id: "pha",           symbol: "PHA",  name: "Phala",     color: "#F59E0B", isMain: false },
];

async function fetchTokenHistory(coinId, days) {
  const url = `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=${days}&interval=daily`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CoinGecko error ${res.status}`);
  const data = await res.json();
  return data.prices.map(([ts, price]) => ({ ts, price }));
}

// Normalise les prix : le premier point = 0%, les suivants = % de variation
function normalize(prices, fromTs) {
  const filtered = prices.filter(p => p.ts >= fromTs);
  if (filtered.length === 0) return [];
  const base = filtered[0].price;
  return filtered.map(p => ({ ts: p.ts, pct: ((p.price - base) / base) * 100 }));
}

// ─── CSV PARSER ───────────────────────────────────────────────────────────────
function parseCsv(text) {
  const lines = text.trim().split("\n").map(l =>
    l.split(",").map(c => c.replace(/^"|"$/g, "").trim())
  );
  const headers = lines[0];
  return lines.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => (obj[h] = row[i] ?? ""));
    return obj;
  }).filter(r => r[headers[0]] !== "");
}

function col(r, ...keys) {
  for (const k of keys) if (r[k] !== undefined && r[k] !== "") return r[k];
  return "";
}

// ─── DESIGN TOKENS ────────────────────────────────────────────────────────────
const deptColors = {
  Tech: "#3B82F6", Support: "#8B5CF6", Sales: "#10B981",
  Ecosystem: "#F59E0B", DevRel: "#EF4444", Marketing: "#FCD15A",
  Token: "#EC4899",
};
const getColor = (dept) => deptColors[dept] || "#94A3B8";

const statusConfig = {
  "Done":        { label: "✓ Done",       color: "#10B981", bg: "rgba(16,185,129,0.1)"  },
  "In Progress": { label: "⟳ En cours",   color: "#F59E0B", bg: "rgba(245,158,11,0.1)"  },
  "Not Started": { label: "○ À démarrer", color: "#94A3B8", bg: "rgba(148,163,184,0.1)" },
};

const fmt = (val, type) => {
  const n = parseFloat(val);
  if (isNaN(n)) return val;
  if (["Revenue","Cumulative","Impressions","Volume"].includes(type))
    return n >= 1e6 ? (n/1e6).toFixed(1)+"M" : n >= 1000 ? (n/1000).toFixed(0)+"K" : n;
  return n;
};

// ─── RADIAL PROGRESS ──────────────────────────────────────────────────────────
function RadialProgress({ pct, color, size = 52 }) {
  const r = size/2 - 6, circ = 2*Math.PI*r;
  const dash = (Math.min(Math.abs(pct),100)/100)*circ;
  return (
    <svg width={size} height={size} style={{ transform:"rotate(-90deg)" }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#f0f2f5" strokeWidth="5"/>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth="5"
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        style={{ transition:"stroke-dasharray 0.8s cubic-bezier(0.4,0,0.2,1)" }}/>
    </svg>
  );
}

// ─── SPARKLINE (simple, 1 token) ──────────────────────────────────────────────
function Sparkline({ data, color, target }) {
  const [tooltip, setTooltip] = useState(null);
  if (!data || data.length === 0) {
    return (
      <div style={{ height:130, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", color:"#7A8299", fontSize:12, gap:8 }}>
        <span style={{ fontSize:24 }}>📭</span>
        <span>Aucun historique disponible</span>
        <span style={{ fontSize:10, color:"#b0bec8" }}>Ajoutez des données dans l'onglet Weekly_Snapshot</span>
      </div>
    );
  }
  const W = 420, H = 130;
  const pad = { top:12, right:24, bottom:28, left:40 };
  const iW = W - pad.left - pad.right, iH = H - pad.top - pad.bottom;
  const values = data.map(d => parseFloat(d.value) || 0);
  const weeks  = data.map(d => d.week);
  const tgt = parseFloat(target) || 0;
  const allV = tgt > 0 ? [...values, tgt] : values;
  const minV = Math.min(...allV) * 0.85, maxV = Math.max(...allV) * 1.1 || 1;
  const xS = i => pad.left + (i / Math.max(values.length-1,1)) * iW;
  const yS = v => pad.top + iH - ((v-minV)/(maxV-minV)) * iH;
  const linePts = values.map((v,i) => `${xS(i)},${yS(v)}`).join(" ");
  const areaPts = [`${xS(0)},${pad.top+iH}`, ...values.map((v,i) => `${xS(i)},${yS(v)}`), `${xS(values.length-1)},${pad.top+iH}`].join(" ");
  const targetY = tgt > 0 ? yS(tgt) : null;
  const gradId  = `g${color.replace("#","")}`;
  return (
    <div style={{ position:"relative" }}>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ overflow:"visible", display:"block" }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.3"/>
            <stop offset="100%" stopColor={color} stopOpacity="0"/>
          </linearGradient>
        </defs>
        {[0,0.25,0.5,0.75,1].map(t => {
          const y = pad.top + t*iH, v = maxV - t*(maxV-minV);
          return (
            <g key={t}>
              <line x1={pad.left} y1={y} x2={pad.left+iW} y2={y} stroke="rgba(0,0,0,0.05)" strokeWidth="1"/>
              <text x={pad.left-5} y={y+4} fontSize="8" fill="#7A8299" textAnchor="end">
                {v>=1000?(v/1000).toFixed(0)+"K":Math.round(v)}
              </text>
            </g>
          );
        })}
        {targetY && (
          <g>
            <line x1={pad.left} y1={targetY} x2={pad.left+iW} y2={targetY} stroke="#34d399" strokeWidth="1.5" strokeDasharray="5 4" opacity="0.7"/>
            <text x={pad.left+iW+4} y={targetY+4} fontSize="8" fill="#34d399">cible</text>
          </g>
        )}
        <polygon points={areaPts} fill={`url(#${gradId})`}/>
        <polyline points={linePts} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"/>
        {values.map((v,i) => (
          <circle key={i} cx={xS(i)} cy={yS(v)} r={tooltip===i?5:3.5} fill={color} stroke="#fff" strokeWidth="2"
            style={{ cursor:"crosshair", transition:"r 0.15s" }}
            onMouseEnter={() => setTooltip(i)} onMouseLeave={() => setTooltip(null)}/>
        ))}
        {tooltip !== null && (
          <g>
            <line x1={xS(tooltip)} y1={pad.top} x2={xS(tooltip)} y2={pad.top+iH} stroke={color} strokeWidth="1" strokeDasharray="3 3" opacity="0.4"/>
            <rect x={xS(tooltip)-32} y={yS(values[tooltip])-32} width={64} height={22} rx={5} fill="#fff" stroke={color} strokeWidth="0.8"/>
            <text x={xS(tooltip)} y={yS(values[tooltip])-17} fontSize="9.5" fill={color} textAnchor="middle" fontWeight="700">
              {values[tooltip]>=1000?(values[tooltip]/1000).toFixed(1)+"K":values[tooltip]}
            </text>
          </g>
        )}
        {weeks.map((w,i) => {
          const show = values.length<=6||i===0||i===weeks.length-1||i%Math.ceil(weeks.length/5)===0;
          return show ? <text key={i} x={xS(i)} y={H-4} fontSize="8" fill="#7A8299" textAnchor="middle">{w}</text> : null;
        })}
      </svg>
      {tooltip !== null && (
        <div style={{ position:"absolute", bottom:28, left:0, right:0, textAlign:"center", fontSize:9, color:"#7A8299" }}>
          {weeks[tooltip]}
        </div>
      )}
    </div>
  );
}

// ─── MULTI-LINE CHART (token performance) ─────────────────────────────────────
function TokenChart({ seriesMap, period, setPeriod }) {
  const [tooltip, setTooltip] = useState(null); // { x, items: [{symbol,color,pct}] }
  const svgRef = useRef(null);

  const periods = [
    { label: "30j",  days: 30  },
    { label: "90j",  days: 90  },
    { label: "YTD",  days: "ytd" },
  ];

  // Merge all series onto common timestamps
  const allSeries = TOKENS.map(t => ({ ...t, data: seriesMap[t.symbol] || [] }))
    .filter(t => t.data.length > 0);

  const W = 460, H = 160;
  const pad = { top:16, right:16, bottom:28, left:44 };
  const iW = W - pad.left - pad.right, iH = H - pad.top - pad.bottom;

  // Flatten all pct values to get global min/max
  const allPcts = allSeries.flatMap(s => s.data.map(d => d.pct));
  const minV = allPcts.length ? Math.min(...allPcts, 0) * 1.1 : -10;
  const maxV = allPcts.length ? Math.max(...allPcts, 0) * 1.1 : 10;

  // Use first series timestamps as x axis
  const baseSeries = allSeries.find(s => s.isMain) || allSeries[0];
  const xCount = baseSeries ? baseSeries.data.length : 0;

  const xS = i => pad.left + (i / Math.max(xCount-1, 1)) * iW;
  const yS = v => pad.top + iH - ((v - minV) / (maxV - minV || 1)) * iH;
  const zeroY = yS(0);

  const handleMouseMove = (e) => {
    if (!svgRef.current || xCount === 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    const mx = (e.clientX - rect.left) / rect.width * W;
    const idx = Math.round((mx - pad.left) / iW * (xCount - 1));
    const clamped = Math.max(0, Math.min(xCount-1, idx));
    const items = allSeries.map(s => ({
      symbol: s.symbol, color: s.color, name: s.name,
      pct: s.data[clamped]?.pct ?? null,
    })).filter(s => s.pct !== null).sort((a,b) => b.pct - a.pct);
    const date = baseSeries?.data[clamped]?.ts
      ? new Date(baseSeries.data[clamped].ts).toLocaleDateString("fr-FR", { day:"numeric", month:"short" })
      : "";
    setTooltip({ x: xS(clamped), idx: clamped, items, date });
  };

  if (allSeries.length === 0) {
    return (
      <div style={{ height:160, display:"flex", alignItems:"center", justifyContent:"center", color:"#7A8299", fontSize:12 }}>
        <span>⟳ Chargement des données crypto...</span>
      </div>
    );
  }

  return (
    <div>
      {/* Period buttons */}
      <div style={{ display:"flex", gap:6, marginBottom:12 }}>
        {periods.map(p => (
          <button key={p.label} onClick={() => setPeriod(p.days)}
            style={{ padding:"4px 12px", borderRadius:6, fontSize:10, fontWeight:600, border:`0.8px solid ${period===p.days?"#FCD15A":"#d1d8e0"}`, background:period===p.days?"#FCD15A":"#fff", color:"#1D1D24", cursor:"pointer", transition:"all 0.2s" }}>
            {p.label}
          </button>
        ))}
      </div>

      {/* Legend */}
      <div style={{ display:"flex", gap:14, marginBottom:10, flexWrap:"wrap" }}>
        {allSeries.map(s => {
          const last = s.data[s.data.length-1]?.pct ?? 0;
          return (
            <div key={s.symbol} style={{ display:"flex", alignItems:"center", gap:5 }}>
              <div style={{ width:20, height:2.5, background:s.color, borderRadius:2 }}/>
              <span style={{ fontSize:9.5, color:s.color, fontWeight:700 }}>{s.symbol}</span>
              <span style={{ fontSize:9, color: last >= 0 ? "#34d399" : "#fb7185" }}>
                {last >= 0 ? "+" : ""}{last.toFixed(1)}%
              </span>
            </div>
          );
        })}
      </div>

      <svg ref={svgRef} width="100%" viewBox={`0 0 ${W} ${H}`}
        style={{ overflow:"visible", display:"block", cursor:"crosshair" }}
        onMouseMove={handleMouseMove} onMouseLeave={() => setTooltip(null)}>

        {/* Grid */}
        {[-1, -0.5, 0, 0.5, 1].map(t => {
          const v = minV + (t+1)/2 * (maxV - minV);
          const y = yS(v);
          const isZero = Math.abs(v) < (maxV-minV)*0.05;
          return (
            <g key={t}>
              <line x1={pad.left} y1={y} x2={pad.left+iW} y2={y}
                stroke={isZero ? "rgba(0,0,0,0.15)" : "rgba(0,0,0,0.05)"}
                strokeWidth={isZero ? 1.5 : 1} strokeDasharray={isZero ? "none" : "none"}/>
              <text x={pad.left-5} y={y+3} fontSize="7.5" fill="#b0bec8" textAnchor="end">
                {v >= 0 ? "+" : ""}{v.toFixed(0)}%
              </text>
            </g>
          );
        })}

        {/* Zero line label */}
        <text x={pad.left-5} y={zeroY+3} fontSize="7.5" fill="#7A8299" textAnchor="end">0%</text>

        {/* Lines */}
        {allSeries.map(s => {
          const pts = s.data.map((d,i) => `${xS(i)},${yS(d.pct)}`).join(" ");
          return (
            <polyline key={s.symbol} points={pts} fill="none" stroke={s.color}
              strokeWidth={s.isMain ? 2.5 : 1.8}
              strokeLinejoin="round" strokeLinecap="round"
              opacity={s.isMain ? 1 : 0.7}/>
          );
        })}

        {/* Tooltip vertical line */}
        {tooltip && (
          <line x1={tooltip.x} y1={pad.top} x2={tooltip.x} y2={pad.top+iH}
            stroke="rgba(255,255,255,0.15)" strokeWidth="1" strokeDasharray="3 3"/>
        )}

        {/* Dots at tooltip position */}
        {tooltip && allSeries.map(s => {
          const d = s.data[tooltip.idx];
          if (!d) return null;
          return <circle key={s.symbol} cx={xS(tooltip.idx)} cy={yS(d.pct)} r={3.5} fill={s.color} stroke="#fff" strokeWidth="1.5"/>;
        })}

        {/* X axis labels */}
        {baseSeries && [0, Math.floor(xCount/2), xCount-1].map(i => {
          const d = baseSeries.data[i];
          if (!d) return null;
          const label = new Date(d.ts).toLocaleDateString("fr-FR", { day:"numeric", month:"short" });
          return <text key={i} x={xS(i)} y={H-4} fontSize="7.5" fill="#b0bec8" textAnchor="middle">{label}</text>;
        })}
      </svg>

      {/* Tooltip box */}
      {tooltip && (
        <div style={{ background:"#fff", border:"0.8px solid #d1d8e0", borderRadius:8, padding:"8px 12px", fontSize:10, marginTop:4, boxShadow:"0 4px 16px rgba(0,0,0,0.08)" }}>
          <div style={{ color:"#7A8299", marginBottom:5, fontSize:9, fontFamily:"'IBM Plex Mono',monospace" }}>{tooltip.date}</div>
          {tooltip.items.map((item, i) => (
            <div key={item.symbol} style={{ display:"flex", justifyContent:"space-between", gap:16, marginBottom:i<tooltip.items.length-1?3:0 }}>
              <span style={{ color:item.color, fontWeight:700 }}>{item.symbol} {i===0?"🥇":i===1?"🥈":i===2?"🥉":"  "}</span>
              <span style={{ color: item.pct >= 0 ? "#34d399" : "#fb7185", fontWeight:600 }}>
                {item.pct >= 0 ? "+" : ""}{item.pct.toFixed(2)}%
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── MINDSHARE TREEMAP ────────────────────────────────────────────────────────
// Algorithme squarified treemap : divise récursivement le rectangle en bandes
// dont les ratios d'aspect sont les plus proches de 1 possible.
function squarify(items, x, y, w, h) {
  if (items.length === 0) return [];
  const total = items.reduce((s, d) => s + d.value, 0);
  if (total === 0 || w <= 0 || h <= 0) return [];

  const rects = [];
  let remaining = [...items].filter(d => d.value > 0); // garde only positifs
  let rx = x, ry = y, rw = w, rh = h;
  let safetyLimit = 0;

  while (remaining.length > 0 && safetyLimit++ < 100) {
    const isHoriz = rw >= rh;
    const remainTotal = remaining.reduce((s, d) => s + d.value, 0);
    if (remainTotal <= 0) break;

    // Cherche combien d'items mettre dans la bande courante
    let best = [remaining[0]], bestWorst = Infinity;
    for (let i = 1; i <= remaining.length; i++) {
      const band = remaining.slice(0, i);
      const bandTotal = band.reduce((s, d) => s + d.value, 0);
      if (bandTotal <= 0) break;
      const bandW = isHoriz ? (bandTotal / remainTotal) * rw : rw;
      const bandH = isHoriz ? rh : (bandTotal / remainTotal) * rh;
      const worst = band.reduce((m, d) => {
        const a = (d.value / bandTotal) * (isHoriz ? bandH : bandW);
        const b2 = isHoriz ? bandH : bandW;
        if (a <= 0) return m;
        const ratio = Math.max(b2 / a, a / b2);
        return Math.max(m, ratio);
      }, 0);
      if (worst < bestWorst) { bestWorst = worst; best = band; }
      else break;
    }

    if (best.length === 0) break; // sécurité anti boucle infinie

    // Place les items de la bande
    const bandTotal = best.reduce((s, d) => s + d.value, 0);
    const bandFrac = bandTotal / remainTotal;
    const bandW = isHoriz ? bandFrac * rw : rw;
    const bandH = isHoriz ? rh : bandFrac * rh;
    let cursor = isHoriz ? ry : rx;

    best.forEach(item => {
      const frac = item.value / bandTotal;
      const iw = isHoriz ? bandW : frac * bandW;
      const ih = isHoriz ? frac * bandH : bandH;
      const ix = isHoriz ? rx : cursor;
      const iy = isHoriz ? cursor : ry;
      rects.push({ ...item, x: ix, y: iy, w: iw, h: ih });
      cursor += isHoriz ? ih : iw;
    });

    if (isHoriz) { rx += bandW; rw -= bandW; }
    else         { ry += bandH; rh -= bandH; }
    remaining = remaining.slice(best.length);
  }
  return rects;
}

// Interpolation rouge → jaune → vert selon t ∈ [0,1]
function heatColor(t) {
  const clamped = Math.max(0, Math.min(1, t));
  if (clamped < 0.5) {
    // rouge → jaune
    const r = 239, g = Math.round(68 + (190 - 68) * (clamped / 0.5)), b = 68;
    return `rgb(${r},${g},${b})`;
  } else {
    // jaune → vert
    const r = Math.round(239 + (34 - 239) * ((clamped - 0.5) / 0.5));
    const g = Math.round(190 + (197 - 190) * ((clamped - 0.5) / 0.5));
    const b = 68;
    return `rgb(${r},${g},${b})`;
  }
}

function MindshareTreemap({ breakdown, week }) {
  const [hovered, setHovered] = useState(null);
  const W = 560, H = 220;
  const PAD = 2;

  if (!breakdown || breakdown.length === 0) {
    return (
      <div style={{ height: H, display:"flex", alignItems:"center", justifyContent:"center",
        color:"#7A8299", fontSize:12, flexDirection:"column", gap:8,
        background:"#f9fafb", borderRadius:10, border:"0.8px solid #e2e8f0" }}>
        <span style={{ fontSize:24 }}>📭</span>
        <span>Données Kaito non disponibles</span>
        <span style={{ fontSize:10, color:"#b0bec8", fontFamily:"'IBM Plex Mono',monospace" }}>Vérifier la clé API Kaito dans Vercel</span>
      </div>
    );
  }

  const total = breakdown.reduce((s, d) => s + (d.value || 0), 0);
  const items = breakdown
    .filter(d => d.value > 0)
    .map(d => ({ token: d.token, value: d.value, pct: total > 0 ? (d.value / total) * 100 : 0 }))
    .sort((a, b) => b.value - a.value);

  const rects = (() => {
    try {
      return squarify(items, PAD, PAD, W - PAD * 2, H - PAD * 2);
    } catch(e) {
      return [];
    }
  })();
  const maxVal = Math.max(...items.map(d => d.value));
  const minVal = Math.min(...items.map(d => d.value));

  return (
    <div style={{ position:"relative" }}>
      {/* Label section */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
        <div style={{ fontSize:10, color:"#7A8299", letterSpacing:"0.12em", textTransform:"uppercase",
          display:"flex", alignItems:"center", gap:8, fontFamily:"'IBM Plex Mono',monospace" }}>
          <span>🟩</span>
          <span>Répartition Mindshare — Privacy Infra</span>
          {week && <span style={{ color:"#7A8299", background:"#f4f6fa",
            border:"0.8px solid #d1d8e0", borderRadius:5, padding:"2px 8px", fontSize:9, fontFamily:"'IBM Plex Mono',monospace" }}>{week}</span>}
        </div>
        {/* Légende couleur */}
        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
          <span style={{ fontSize:9, color:"#7A8299", fontFamily:"'IBM Plex Mono',monospace" }}>faible</span>
          <div style={{ width:80, height:8, borderRadius:4, background:"linear-gradient(90deg,rgb(239,68,68),rgb(239,190,68),rgb(34,197,68))" }}/>
          <span style={{ fontSize:9, color:"#7A8299", fontFamily:"'IBM Plex Mono',monospace" }}>fort</span>
        </div>
      </div>

      {/* SVG treemap */}
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display:"block", borderRadius:10, overflow:"hidden" }}>
        {/* Fond */}
        <rect x={0} y={0} width={W} height={H} fill="#f9fafb" rx={8}/>

        {rects.map((r, i) => {
          const t = maxVal > minVal ? (r.value - minVal) / (maxVal - minVal) : 0.5;
          const color = heatColor(t);
          const isRLC = r.token === "RLC";
          const isHov = hovered === r.token;
          const showLabel = r.w > 38 && r.h > 24;
          const showPct   = r.w > 50 && r.h > 40;

          return (
            <g key={r.token}
              onMouseEnter={() => setHovered(r.token)}
              onMouseLeave={() => setHovered(null)}
              style={{ cursor:"default" }}>
              <rect
                x={r.x + 1} y={r.y + 1}
                width={Math.max(r.w - 2, 1)} height={Math.max(r.h - 2, 1)}
                rx={4}
                fill={color}
                fillOpacity={isHov ? 0.95 : 0.75}
                stroke={isRLC ? "#ffffff" : isHov ? "rgba(255,255,255,0.6)" : "rgba(0,0,0,0.2)"}
                strokeWidth={isRLC ? 2 : isHov ? 1.5 : 0.5}
                style={{ transition:"fill-opacity 0.15s" }}
              />
              {/* Glow RLC */}
              {isRLC && (
                <rect
                  x={r.x + 1} y={r.y + 1}
                  width={Math.max(r.w - 2, 1)} height={Math.max(r.h - 2, 1)}
                  rx={4} fill="none"
                  stroke="#ffffff" strokeWidth={3} strokeOpacity={0.15}
                />
              )}
              {showLabel && (
                <text
                  x={r.x + r.w / 2} y={r.y + r.h / 2 + (showPct ? -6 : 4)}
                  textAnchor="middle" dominantBaseline="middle"
                  fontSize={Math.min(Math.max(r.w / 5, 9), 15)}
                  fontWeight={isRLC ? "800" : "700"}
                  fill={t > 0.4 ? "#1D1D24" : "#fff"}
                  fontFamily="'DM Sans', sans-serif"
                  style={{ pointerEvents:"none" }}>
                  {r.token}
                </text>
              )}
              {showPct && (
                <text
                  x={r.x + r.w / 2} y={r.y + r.h / 2 + 10}
                  textAnchor="middle" dominantBaseline="middle"
                  fontSize={Math.min(Math.max(r.w / 7, 8), 11)}
                  fontWeight="500"
                  fill={t > 0.4 ? "rgba(15,23,42,0.75)" : "rgba(248,250,252,0.75)"}
                  fontFamily="'IBM Plex Mono', monospace"
                  style={{ pointerEvents:"none" }}>
                  {r.pct.toFixed(1)}%
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Tooltip hover */}
      {hovered && (() => {
        const item = items.find(d => d.token === hovered);
        if (!item) return null;
        const t = maxVal > minVal ? (item.value - minVal) / (maxVal - minVal) : 0.5;
        return (
          <div style={{ marginTop:8, background:"#fff", border:"0.8px solid #d1d8e0",
            borderRadius:8, padding:"8px 14px", fontSize:11,
            display:"flex", justifyContent:"space-between", alignItems:"center", gap:24, boxShadow:"0 4px 16px rgba(0,0,0,0.07)" }}>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <div style={{ width:10, height:10, borderRadius:3, background:heatColor(t) }}/>
              <span style={{ fontWeight:700, color:"#1D1D24", fontFamily:"'DM Sans',sans-serif" }}>
                {item.token}
                {item.token === "RLC" && <span style={{ color:"#FCD15A", marginLeft:6, fontSize:9 }}>← iExec</span>}
              </span>
            </div>
            <div style={{ display:"flex", gap:20 }}>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontSize:9, color:"#7A8299", fontFamily:"'IBM Plex Mono',monospace" }}>Part mindshare</div>
                <div style={{ fontWeight:700, color:heatColor(t), fontFamily:"'DM Sans',sans-serif" }}>
                  {item.pct.toFixed(2)}%
                </div>
              </div>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontSize:9, color:"#7A8299", fontFamily:"'IBM Plex Mono',monospace" }}>Rang</div>
                <div style={{ fontWeight:700, color:"#7A8299", fontFamily:"'IBM Plex Mono',monospace" }}>
                  #{items.findIndex(d => d.token === hovered) + 1}/10
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}


// ─── SALES DASHBOARD ──────────────────────────────────────────────────────────

function FunnelBar({ data }) {
  if (!data || data.length === 0) return null;
  const max = Math.max(...data.map(d => d.count), 1);
  const stageColors = {
    'Identified':    '#94A3B8',
    'Researched':    '#7A8299',
    'Contacted':     '#3B82F6',
    'Discovery Call':'#FCD15A',
    'ETHcc meeting': '#F59E0B',
    'Not Ready Yet': '#FB923C',
    'Not Interested':'#EF4444',
  };
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
      {data.filter(d => d.count > 0).map(d => (
        <div key={d.stage} style={{ display:'flex', alignItems:'center', gap:12 }}>
          <div style={{ width:130, fontSize:11, color:'#7A8299', fontFamily:"'IBM Plex Mono',monospace", textAlign:'right', flexShrink:0 }}>
            {d.stage}
          </div>
          <div style={{ flex:1, height:28, background:'#f4f6fa', borderRadius:6, overflow:'hidden', position:'relative' }}>
            <div style={{
              width:`${(d.count/max)*100}%`, height:'100%',
              background: stageColors[d.stage] || '#94A3B8',
              borderRadius:6, opacity:0.85,
              transition:'width 0.8s cubic-bezier(0.4,0,0.2,1)',
              display:'flex', alignItems:'center', paddingLeft:10,
            }}>
              {d.count > 2 && (
                <span style={{ fontSize:11, fontWeight:700, color: d.stage === 'Discovery Call' || d.stage === 'ETHcc meeting' ? '#1D1D24' : '#fff', fontFamily:"'IBM Plex Mono',monospace" }}>
                  {d.count}
                </span>
              )}
            </div>
            {d.count <= 2 && (
              <span style={{ position:'absolute', left:`${(d.count/max)*100 + 1}%`, top:'50%', transform:'translateY(-50%)', fontSize:11, fontWeight:700, color:'#1D1D24', fontFamily:"'IBM Plex Mono',monospace" }}>
                {d.count}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function ConversionFlow({ rates, total, totalContacted, totalReponse, totalMeeting }) {
  const steps = [
    { label:'Total Leads',  value:total,          pct:100,                    color:'#94A3B8' },
    { label:'Contactés',    value:totalContacted,  pct:rates.identifiedToContacted, color:'#3B82F6' },
    { label:'Réponses',     value:totalReponse,    pct:rates.contactedToReponse,    color:'#8B5CF6' },
    { label:'Meetings',     value:totalMeeting,    pct:rates.reponseToMeeting,      color:'#F59E0B' },
    { label:'Discovery',    value:null,            pct:rates.meetingToDiscovery,    color:'#FCD15A' },
  ];
  return (
    <div style={{ display:'flex', alignItems:'stretch', gap:0 }}>
      {steps.map((s, i) => (
        <div key={s.label} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center' }}>
          <div style={{
            width:'100%', padding:'14px 8px', background:'#fff',
            border:'0.8px solid #d1d8e0', borderRadius:i===0?'10px 0 0 10px':i===steps.length-1?'0 10px 10px 0':'0',
            borderLeft: i>0 ? 'none' : '0.8px solid #d1d8e0',
            textAlign:'center', position:'relative',
          }}>
            <div style={{ fontSize:10, color:'#7A8299', fontFamily:"'IBM Plex Mono',monospace", textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:6 }}>
              {s.label}
            </div>
            <div style={{ fontSize:22, fontWeight:700, color:s.color, fontFamily:"'IBM Plex Mono',monospace" }}>
              {s.value !== null ? s.value : ''}
            </div>
            {i > 0 && (
              <div style={{ fontSize:10, color:s.pct >= 50 ? '#10B981' : s.pct >= 25 ? '#F59E0B' : '#EF4444', fontWeight:600, marginTop:4, fontFamily:"'IBM Plex Mono',monospace" }}>
                {s.pct}%
              </div>
            )}
            {i < steps.length - 1 && (
              <div style={{ position:'absolute', right:-12, top:'50%', transform:'translateY(-50%)', zIndex:2, fontSize:16, color:'#d1d8e0' }}>→</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function OwnerCard({ d }) {
  return (
    <div style={{ background:'#fff', border:'0.8px solid #d1d8e0', borderRadius:10, padding:'20px 24px' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
        <div>
          <div style={{ fontSize:13, fontWeight:700, color:'#1D1D24' }}>{d.owner}</div>
          <div style={{ fontSize:11, color:'#7A8299', fontFamily:"'IBM Plex Mono',monospace", marginTop:2 }}>{d.total} leads assignés</div>
        </div>
        <div style={{ display:'flex', gap:16 }}>
          {[
            { label:'Réponse', value:d.tauxRep+'%', color: d.tauxRep >= 30 ? '#10B981' : d.tauxRep >= 15 ? '#F59E0B' : '#EF4444' },
            { label:'Meeting',  value:d.tauxMeet+'%', color: d.tauxMeet >= 20 ? '#10B981' : d.tauxMeet >= 10 ? '#F59E0B' : '#EF4444' },
          ].map(m => (
            <div key={m.label} style={{ textAlign:'center' }}>
              <div style={{ fontSize:11, color:'#7A8299', fontFamily:"'IBM Plex Mono',monospace", marginBottom:4 }}>{m.label}</div>
              <div style={{ fontSize:20, fontWeight:700, color:m.color, fontFamily:"'IBM Plex Mono',monospace" }}>{m.value}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
        {['Contacted','Discovery Call','ETHcc meeting','Not Ready Yet','Not Interested'].map(s => {
          const n = d.stageBreak[s] || 0;
          if (!n) return null;
          const colors = { 'Contacted':'#3B82F6','Discovery Call':'#FCD15A','ETHcc meeting':'#F59E0B','Not Ready Yet':'#FB923C','Not Interested':'#EF4444' };
          return (
            <div key={s} style={{ padding:'3px 10px', borderRadius:20, fontSize:10, fontWeight:600, fontFamily:"'IBM Plex Mono',monospace",
              background:`${colors[s]}15`, color:colors[s], border:`0.8px solid ${colors[s]}44` }}>
              {n} {s}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ProspectCard({ p }) {
  const stageColor = p.stage === 'ETHcc meeting' ? '#F59E0B' : '#FCD15A';
  return (
    <div style={{ background:'#fff', border:'0.8px solid #d1d8e0', borderRadius:10, padding:'16px 20px',
      borderLeft:`3px solid ${stageColor}` }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:8 }}>
        <div>
          <div style={{ fontSize:14, fontWeight:700, color:'#1D1D24' }}>{p.company}</div>
          <div style={{ fontSize:11, color:'#7A8299', marginTop:2 }}>{p.verticale} · {p.owner}</div>
        </div>
        <div style={{ padding:'3px 10px', borderRadius:20, fontSize:10, fontWeight:700, fontFamily:"'IBM Plex Mono',monospace",
          background:`${stageColor}15`, color:stageColor, border:`0.8px solid ${stageColor}44`, flexShrink:0 }}>
          {p.stage}
        </div>
      </div>
      {p.tvl && p.tvl !== '//' && p.tvl !== '' && (
        <div style={{ fontSize:10, color:'#7A8299', marginBottom:6, fontFamily:"'IBM Plex Mono',monospace" }}>
          TVL : <span style={{ color:'#1D1D24', fontWeight:600 }}>{p.tvl}</span>
        </div>
      )}
      {p.recentNews && (
        <div style={{ fontSize:11, color:'#7A8299', lineHeight:1.5,
          display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical', overflow:'hidden' }}>
          {p.recentNews}
        </div>
      )}
    </div>
  );
}

function SalesDashboard({ data, loading }) {
  if (loading) return (
    <div style={{ textAlign:'center', padding:'80px 0', color:'#7A8299' }}>
      <div style={{ fontSize:40, marginBottom:16 }}>⟳</div>
      <div style={{ fontSize:13, fontFamily:"'IBM Plex Mono',monospace" }}>Chargement Airtable...</div>
    </div>
  );

  if (!data || !data.enabled) return (
    <div style={{ background:'#fff', border:'0.8px solid #d1d8e0', borderRadius:10, padding:'48px 32px', textAlign:'center' }}>
      <div style={{ fontSize:32, marginBottom:16 }}>🔌</div>
      <div style={{ fontSize:16, fontWeight:600, color:'#1D1D24', marginBottom:8 }}>Airtable non connecté</div>
      <div style={{ fontSize:13, color:'#7A8299', fontFamily:"'IBM Plex Mono',monospace" }}>
        Ajouter AIRTABLE_API_KEY, AIRTABLE_BASE_ID et AIRTABLE_TABLE_ID dans Vercel → Settings → Environment Variables
      </div>
    </div>
  );

  const { total, totalReponse, totalMeeting, conversionRates, funnel, byOwner, byVerticale, bySegment, topBlockers, activeProspects } = data;

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:24 }}>

      {/* ── KPIs rapides ── */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))', gap:12 }}>
        {[
          { label:'Total Leads',     value:total,         icon:'📋', color:'#3B82F6' },
          { label:'Taux Réponse',    value:Math.round(totalReponse/total*100)+'%', icon:'💬', color: Math.round(totalReponse/total*100) >= 25 ? '#10B981' : '#F59E0B' },
          { label:'Taux Meeting',    value:Math.round(totalMeeting/total*100)+'%', icon:'🤝', color: Math.round(totalMeeting/total*100) >= 20 ? '#10B981' : '#F59E0B' },
          { label:'Discovery Calls', value:activeProspects.length, icon:'🔍', color:'#FCD15A' },
          { label:'Réponse→Meeting', value:conversionRates.reponseToMeeting+'%', icon:'📈', color: conversionRates.reponseToMeeting >= 70 ? '#10B981' : '#F59E0B' },
        ].map(m => (
          <div key={m.label} style={{ background:'#fff', border:'0.8px solid #d1d8e0', borderRadius:10, padding:'16px 18px' }}>
            <div style={{ fontSize:18, marginBottom:8 }}>{m.icon}</div>
            <div style={{ fontSize:24, fontWeight:700, color:m.color, fontFamily:"'IBM Plex Mono',monospace", lineHeight:1 }}>{m.value}</div>
            <div style={{ fontSize:10, color:'#7A8299', marginTop:6, fontFamily:"'IBM Plex Mono',monospace", textTransform:'uppercase', letterSpacing:'0.08em' }}>{m.label}</div>
          </div>
        ))}
      </div>

      {/* ── Conversion Flow ── */}
      <div style={{ background:'#fff', border:'0.8px solid #d1d8e0', borderRadius:10, padding:'24px' }}>
        <div style={{ fontSize:11, fontFamily:"'IBM Plex Mono',monospace", color:'#7A8299', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:16 }}>
          PIPELINE · TAUX DE CONVERSION
        </div>
        <ConversionFlow rates={conversionRates} total={total} totalContacted={data.totalContacted} totalReponse={totalReponse} totalMeeting={totalMeeting} />
      </div>

      {/* ── Funnel + Verticales ── */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
        <div style={{ background:'#fff', border:'0.8px solid #d1d8e0', borderRadius:10, padding:'24px' }}>
          <div style={{ fontSize:11, fontFamily:"'IBM Plex Mono',monospace", color:'#7A8299', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:20 }}>
            FUNNEL PAR STAGE
          </div>
          <FunnelBar data={funnel} />
        </div>

        <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
          {/* Verticales */}
          <div style={{ background:'#fff', border:'0.8px solid #d1d8e0', borderRadius:10, padding:'20px 24px', flex:1 }}>
            <div style={{ fontSize:11, fontFamily:"'IBM Plex Mono',monospace", color:'#7A8299', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:14 }}>
              PAR VERTICALE
            </div>
            {byVerticale.filter(v => v.count > 0).sort((a,b) => b.count-a.count).map(v => (
              <div key={v.verticale} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
                <div style={{ fontSize:12, color:'#1D1D24', fontWeight:500 }}>{v.verticale}</div>
                <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                  <div style={{ width:80, height:6, background:'#f4f6fa', borderRadius:4, overflow:'hidden' }}>
                    <div style={{ width:`${(v.count/total)*100}%`, height:'100%', background:'#FCD15A', borderRadius:4 }}/>
                  </div>
                  <div style={{ fontSize:11, fontFamily:"'IBM Plex Mono',monospace", color:'#7A8299', width:20, textAlign:'right' }}>{v.count}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Segments */}
          <div style={{ background:'#fff', border:'0.8px solid #d1d8e0', borderRadius:10, padding:'20px 24px', flex:1 }}>
            <div style={{ fontSize:11, fontFamily:"'IBM Plex Mono',monospace", color:'#7A8299', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:14 }}>
              PAR SEGMENT
            </div>
            {bySegment.sort((a,b) => b.count-a.count).map(s => (
              <div key={s.segment} style={{ marginBottom:10 }}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                  <div style={{ fontSize:11, color:'#1D1D24' }}>{s.segment}</div>
                  <div style={{ fontSize:11, fontFamily:"'IBM Plex Mono',monospace", color:'#7A8299' }}>{s.count} · {s.meetings} mtg · {s.discovery} disc</div>
                </div>
                <div style={{ height:4, background:'#f4f6fa', borderRadius:4, overflow:'hidden' }}>
                  <div style={{ width:`${(s.count/total)*100}%`, height:'100%', background:'#3B82F6', borderRadius:4 }}/>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Par commercial ── */}
      <div>
        <div style={{ fontSize:11, fontFamily:"'IBM Plex Mono',monospace", color:'#7A8299', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:14 }}>
          PERFORMANCE PAR COMMERCIAL
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(340px,1fr))', gap:14 }}>
          {byOwner.sort((a,b) => b.total-a.total).map(d => <OwnerCard key={d.owner} d={d} />)}
        </div>
      </div>

      {/* ── Top Prospects ── */}
      <div>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
          <div style={{ fontSize:11, fontFamily:"'IBM Plex Mono',monospace", color:'#7A8299', textTransform:'uppercase', letterSpacing:'0.1em' }}>
            PROSPECTS ACTIFS — DISCOVERY CALLS & MEETINGS
          </div>
          <div style={{ fontSize:11, color:'#FCD15A', fontFamily:"'IBM Plex Mono',monospace", fontWeight:700 }}>
            {activeProspects.length} en cours
          </div>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(300px,1fr))', gap:12 }}>
          {activeProspects.map(p => <ProspectCard key={p.company} p={p} />)}
        </div>
      </div>

      {/* ── Blockers ── */}
      {topBlockers.length > 0 && (
        <div style={{ background:'#fff', border:'0.8px solid #d1d8e0', borderRadius:10, padding:'24px' }}>
          <div style={{ fontSize:11, fontFamily:"'IBM Plex Mono',monospace", color:'#7A8299', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:16 }}>
            PRINCIPAUX BLOCKERS
          </div>
          <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
            {topBlockers.map(b => (
              <div key={b.name} style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 14px',
                background:'rgba(239,68,68,0.05)', border:'0.8px solid rgba(239,68,68,0.2)', borderRadius:8 }}>
                <span style={{ fontSize:13 }}>⚠</span>
                <span style={{ fontSize:12, color:'#EF4444', fontWeight:600 }}>{b.name}</span>
                <span style={{ fontSize:11, color:'#7A8299', fontFamily:"'IBM Plex Mono',monospace" }}>×{b.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}


// ─── KPI MODAL ────────────────────────────────────────────────────────────────
function KpiModal({ kpi, history, onClose, tokenData, tokenPeriod, setTokenPeriod }) {
  const color  = getColor(kpi.dept);
  const status = statusConfig[kpi.status] || statusConfig["Not Started"];
  const pct    = Math.round(Math.min(parseFloat(kpi.progress_pct||0)*100, 100));
  const kpiHist = (kpi.kaitoHistory || history
    .filter(h => String(h.kpi_id).trim() === String(kpi.id).trim())
    .sort((a,b) => a.week.localeCompare(b.week)));
  const isToken = kpi.id === "TOKEN_PERF";
  const isMindshare = String(kpi.id).trim() === "9";

  useEffect(() => {
    const fn = e => { if (e.key==="Escape") onClose(); };
    document.addEventListener("keydown", fn);
    return () => document.removeEventListener("keydown", fn);
  }, [onClose]);

  return (
    <div onClick={onClose} style={{
      position:"fixed", inset:0, background:"rgba(29,29,36,0.4)",
      backdropFilter:"blur(8px)", zIndex:9999,
      display:"flex", alignItems:"center", justifyContent:"center", padding:"24px 16px",
      overflowY:"auto",
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background:"#fff",
        border:`0.8px solid #d1d8e0`,
        borderRadius:24, width:"100%", maxWidth: isMindshare ? 760 : 680,
        position:"relative",
        boxShadow:"0 20px 60px rgba(0,0,0,0.12), 0 4px 20px rgba(0,0,0,0.06)",
        overflow:"hidden",
      }}>

        {/* Bande colorée en haut */}
        <div style={{ height:3, background:`linear-gradient(90deg,${color},${color}66,transparent)`, width:"100%" }}/>

        {/* Contenu */}
        <div style={{ padding:"28px 32px 32px" }}>

          {/* Header */}
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:24 }}>
            <div style={{ flex:1, paddingRight:16 }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
                <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.15em", color, textTransform:"uppercase",
                  background:`${color}12`, border:`0.8px solid ${color}44`, borderRadius:5, padding:"3px 8px", fontFamily:"'IBM Plex Mono',monospace" }}>
                  {kpi.dept}
                </div>
                <div style={{ fontSize:10, color:"#7A8299", letterSpacing:"0.1em", textTransform:"uppercase", fontFamily:"'IBM Plex Mono',monospace" }}>
                  {kpi.type}
                </div>
              </div>
              <div style={{ fontFamily:"'DM Sans',sans-serif", fontSize:20, fontWeight:700, color:"#1D1D24", lineHeight:1.3 }}>
                {kpi.name}
              </div>
            </div>
            <button onClick={onClose} style={{
              background:"#f4f6fa", border:"0.8px solid #d1d8e0",
              borderRadius:8, width:34, height:34, cursor:"pointer", color:"#7A8299",
              fontSize:16, display:"flex", alignItems:"center", justifyContent:"center",
              fontFamily:"inherit", flexShrink:0, transition:"all 0.2s",
            }}>✕</button>
          </div>

          {/* Stats row */}
          <div style={{
            display:"grid", gridTemplateColumns: isToken ? "1fr auto" : "1fr auto auto",
            gap:16, alignItems:"center",
            background:"#f9fafb", border:"0.8px solid #e2e8f0",
            borderRadius:10, padding:"18px 20px", marginBottom:20,
          }}>
            <div>
              <div style={{ fontSize:11, color:"#7A8299", marginBottom:6, letterSpacing:"0.05em" }}>
                {isToken ? "Classement actuel" : "Progression"}
              </div>
              {kpi.displayLabel ? (
                <>
                  <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:22, fontWeight:700, color:"#1D1D24" }}>
                    {kpi.displayLabel}
                  </div>
                  {kpi.latestRaw && (
                    <div style={{ fontSize:11, color:"#7A8299", marginTop:4 }}>{kpi.latestRaw}</div>
                  )}
                </>
              ) : (
                <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:22, fontWeight:700, color:"#1D1D24" }}>
                  {fmt(kpi.current, kpi.type)}
                  <span style={{ fontSize:14, color:"#7A8299", fontWeight:400, marginLeft:6 }}>
                    / {fmt(kpi.target, kpi.type)}
                  </span>
                </div>
              )}
            </div>

            {!isToken && (
              <div style={{ textAlign:"center" }}>
                <div style={{ fontSize:11, color:"#7A8299", marginBottom:6 }}>Complétion</div>
                <div style={{ position:"relative", width:64, height:64 }}>
                  <RadialProgress pct={pct} color={color} size={64}/>
                  <div style={{ position:"absolute", top:"50%", left:"50%", transform:"translate(-50%,-50%)",
                    fontSize:13, fontWeight:700, color }}>
                    {pct}%
                  </div>
                </div>
              </div>
            )}

            <div style={{ textAlign:"center" }}>
              <div style={{ fontSize:11, color:"#7A8299", marginBottom:6 }}>Statut</div>
              <div style={{ fontSize:11, fontWeight:700, padding:"6px 14px", borderRadius:20,
                color:status.color, background:status.bg, border:`1px solid ${status.color}33`, whiteSpace:"nowrap" }}>
                {status.label}
              </div>
            </div>
          </div>

          {/* Barre de progression (hors Token) */}
          {!isToken && (
            <div style={{ marginBottom:24 }}>
              <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, color:"#7A8299", marginBottom:6, fontFamily:"'IBM Plex Mono',monospace" }}>
                <span>0%</span>
                <span style={{ color }}>{pct}% atteint</span>
                <span>100%</span>
              </div>
              <div style={{ height:8, background:"#f4f6fa", borderRadius:8, overflow:"hidden", border:"0.8px solid #e2e8f0" }}>
                <div style={{
                  width:`${pct}%`, height:"100%",
                  background:`linear-gradient(90deg,${color},${color}88)`,
                  borderRadius:8, transition:"width 1s ease",
                  boxShadow:"none",
                }}/>
              </div>
            </div>
          )}

          {/* Divider */}
          <div style={{ height:"0.8px", background:"#e2e8f0", marginBottom:20 }}/>

          {/* Chart */}
          <div>
            <div style={{ fontSize:10, color:"#7A8299", letterSpacing:"0.12em", textTransform:"uppercase", marginBottom:16,
              display:"flex", alignItems:"center", gap:8, fontFamily:"'IBM Plex Mono',monospace" }}>
              <span>📈</span>
              <span>{isToken ? "Performance relative (base 0% au départ)" : "Évolution hebdomadaire"}</span>
              {!isToken && kpiHist.length > 0 && (
                <span style={{ color, background:`${color}10`, border:`0.8px solid ${color}44`,
                  borderRadius:5, padding:"2px 8px", fontSize:9, fontFamily:"'IBM Plex Mono',monospace" }}>
                  {kpiHist.length} sem.
                </span>
              )}
            </div>
            {isToken
              ? <TokenChart seriesMap={tokenData} period={tokenPeriod} setPeriod={setTokenPeriod}/>
              : <Sparkline data={kpiHist} color={color} target={kpi.target}/>
            }
          </div>

          {/* Treemap mindshare — KPI 9 uniquement */}
          {isMindshare && (
            <>
              <div style={{ height:"0.8px", background:"#e2e8f0", margin:"24px 0 20px" }}/>
              <MindshareTreemap
                breakdown={kpi.breakdown}
                week={kpi.latestWeek || kpi.latestRaw?.match?.(/Kaito ([\w-]+)/)?.[1]}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── KPI CARD ─────────────────────────────────────────────────────────────────
function KpiCard({ kpi, history, onOpen }) {
  const [hovered, setHovered] = useState(false);
  const color  = getColor(kpi.dept);
  const status = statusConfig[kpi.status] || statusConfig["Not Started"];
  const pct    = Math.round(Math.min(parseFloat(kpi.progress_pct||0)*100, 100));
  const hasHist = history.some(h => String(h.kpi_id).trim() === String(kpi.id).trim());
  const isToken = kpi.id === "TOKEN_PERF";

  return (
    <div onClick={() => onOpen(kpi)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? "#fafbfc" : "#fff",
        border: `0.8px solid ${hovered ? color : "#d1d8e0"}`,
        borderRadius:10, padding:"18px 20px", transition:"all 0.22s ease",
        transform: hovered ? "translateY(-2px)" : "translateY(0)",
        boxShadow: hovered ? `0 4px 16px rgba(0,0,0,0.07)` : "none",
        display:"flex", flexDirection:"column", gap:10,
        position:"relative", overflow:"hidden", cursor:"pointer",
      }}>
      <div style={{ position:"absolute", top:0, left:0, width:`${isToken ? 100 : pct}%`, height:2, background:color, borderRadius:"0 2px 0 0", transition:"width 0.8s ease" }}/>

      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:8 }}>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.1em", color, textTransform:"uppercase", marginBottom:4, fontFamily:"'IBM Plex Mono',monospace" }}>
            {kpi.dept} · {kpi.type}
          </div>
          <div style={{ fontSize:14, fontWeight:600, color:"#1D1D24", lineHeight:1.3 }}>{kpi.name}</div>
        </div>
        {isToken ? (
          <div style={{ fontSize:22, fontWeight:800, fontFamily:"'IBM Plex Mono',monospace", color, flexShrink:0 }}>
            {kpi.rank ? `#${kpi.rank}` : "—"}
          </div>
        ) : (
          <div style={{ position:"relative", flexShrink:0 }}>
            <RadialProgress pct={pct} color={color}/>
            <div style={{ position:"absolute", top:"50%", left:"50%", transform:"translate(-50%,-50%)", fontSize:10, fontWeight:700, color }}>
              {pct}%
            </div>
          </div>
        )}
      </div>

      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div style={{ fontSize:11, color:"#7A8299" }}>
          {kpi.displayLabel ? (
            <span style={{ color:"#1D1D24", fontWeight:600 }}>{kpi.displayLabel}</span>
          ) : (
            <>
              <span style={{ color:"#1D1D24", fontWeight:600 }}>{fmt(kpi.current, kpi.type)}</span>
              <span> / {fmt(kpi.target, kpi.type)}</span>
            </>
          )}
          {kpi.latestRaw && (
            <div style={{ fontSize:10, color:"#7A8299", marginTop:2 }}>{kpi.latestRaw}</div>
          )}
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          {(hasHist || isToken) && <span style={{ fontSize:9, color:color+"aa" }}>📈</span>}
          <div style={{ fontSize:10, fontWeight:700, padding:"3px 9px", borderRadius:20, color:status.color, background:status.bg }}>
            {status.label}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const [activeTab,     setActiveTab]   = useState("kpis"); // "kpis" | "performance"
  const [salesData,     setSalesData]    = useState(null);
  const [salesLoading, setSalesLoading] = useState(false);
  const [kpis,        setKpis]        = useState([]);
  const [history,     setHistory]     = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState(null);
  const [filter,      setFilter]      = useState("All");
  const [lastSync,    setLastSync]    = useState(null);
  const [modal,       setModal]       = useState(null);
  const [tokenData,    setTokenData]    = useState({});
  const [tokenPeriod,  setTokenPeriod]  = useState("ytd");
  const [tokenLoading, setTokenLoading] = useState(true);
  // Kaito
  const [kaitoEnabled, setKaitoEnabled] = useState(false);
  const [kaitoData,    setKaitoData]    = useState({ mindshare: null, tee_rank: null });
  const [kaitoStatus,  setKaitoStatus]  = useState("idle"); // idle | loading | ok | error | disabled

  // ── Vérifie juste si Kaito est configuré (badge header) ─────────────────
  useEffect(() => {
    fetchKaitoStatus().then(s => {
      setKaitoEnabled(s.enabled);
      if (s.enabled) {
        setKaitoStatus("loading");
        fetchKaitoMindshare().then(data => {
          if (data) {
            const newKaitoData = { mindshare: data, tee_rank: null };
            setKaitoData(newKaitoData);
            setKaitoStatus("ok");
            // Re-fetch immédiatement avec les données fraîches (évite closure stale)
            fetchData(newKaitoData);
          } else {
            setKaitoStatus("error");
          }
        }).catch(() => setKaitoStatus("error"));
      } else {
        setKaitoStatus("disabled");
      }
    });
  }, []);

  // ── Fetch token data (re-runs when tokenPeriod changes) ──────────────────
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setTokenLoading(true);
      try {
        const ytdStart = new Date(new Date().getFullYear(), 0, 1).getTime();
        const days = tokenPeriod === "ytd"
          ? Math.ceil((Date.now() - ytdStart) / 86400000) + 1
          : tokenPeriod;

        const results = await Promise.all(
          TOKENS.map(t => fetchTokenHistory(t.id, days).catch(() => []))
        );

        if (cancelled) return;

        const fromTs = tokenPeriod === "ytd" ? ytdStart : Date.now() - tokenPeriod * 86400000;
        const map = {};
        TOKENS.forEach((t, i) => {
          map[t.symbol] = normalize(results[i], fromTs);
        });
        setTokenData(map);
      } catch(e) {
        console.error("Token fetch error", e);
      } finally {
        if (!cancelled) setTokenLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [tokenPeriod]);

  // ── Build the synthetic TOKEN_PERF KPI from tokenData ────────────────────
  const buildTokenKpi = () => {
    const rlcData = tokenData["RLC"] || [];
    const rlcLast = rlcData[rlcData.length - 1]?.pct ?? null;

    if (rlcLast === null || tokenLoading) {
      return {
        id: "TOKEN_PERF", name: "Top Performance YTD vs Competitors",
        dept: "Token", type: "Ranking",
        progress_pct: 0, status: "In Progress", weight: 0,
        rank: null,
        displayLabel: tokenLoading ? "⟳ Chargement..." : "Données indisponibles",
        latestRaw: "",
      };
    }

    // Rank RLC vs all tokens
    const allLast = TOKENS.map(t => ({
      symbol: t.symbol,
      pct: (tokenData[t.symbol] || []).slice(-1)[0]?.pct ?? -Infinity,
    })).sort((a,b) => b.pct - a.pct);

    const rank = allLast.findIndex(t => t.symbol === "RLC") + 1;
    const sign = rlcLast >= 0 ? "+" : "";

    return {
      id: "TOKEN_PERF", name: "Top Performance YTD vs Competitors",
      dept: "Token", type: "Ranking",
      progress_pct: 0, status: "In Progress", weight: 0,
      rank,
      displayLabel: `#${rank}/4 · RLC ${sign}${rlcLast.toFixed(1)}%`,
      latestRaw: `vs ROSE · SCRT · PHA`,
    };
  };

  // ── Fetch Google Sheets ───────────────────────────────────────────────────
  const fetchData = async (liveKaitoData = null) => {
    setLoading(true); setError(null);
    // Utilise les données Kaito passées en param ou le state courant
    const kaito = liveKaitoData ?? kaitoData;
    try {
      const resMaster = await fetch(csvUrl(GID_MASTER));
      if (!resMaster.ok) throw new Error(`HTTP ${resMaster.status}`);
      const masterRows = parseCsv(await resMaster.text());
      const baseKpis = masterRows
        .filter(r => {
          const id = col(r, "ID", "KPI_ID", "KPI ID");
          return id !== "" && !isNaN(parseFloat(id));
        })
        .map(r => ({
          id:           col(r, "ID", "KPI_ID", "KPI ID"),
          name:         col(r, "KPI", "KPI_Name", "KPI_name", "KPI Name"),
          dept:         col(r, "Département", "Department", "Dept"),
          type:         col(r, "Type"),
          target:       col(r, "Target") || 0,
          baseline:     col(r, "Baseline") || 0,
          current:      col(r, "Valeur actuelle", "Current_Value", "Current") || 0,
          progress_pct: col(r, "Progression", "Progress_%", "Progress") || 0,
          status:       col(r, "Statut", "Status") || "Not Started",
          weight:       col(r, "Poids", "Weight") || 0,
        })).filter(k => k.name);

      let histData = [];
      try {
        const resHist = await fetch(csvUrl(GID_HISTORY));
        if (resHist.ok) {
          const histRows = parseCsv(await resHist.text());
          histData = histRows
            .filter(r => {
              const week = col(r, "Semaine", "Week", "week");
              return week !== "" && week.match(/^\d{4}-W\d{2}$/);
            })
            .map(r => ({
              week:   col(r, "Semaine", "Week", "week"),
              kpi_id: col(r, "ID (auto)", "KPI_ID", "kpi_id", "ID"),
              value:  col(r, "Valeur", "Value", "value") || 0,
            })).filter(h => h.week && h.kpi_id && !isNaN(parseFloat(h.kpi_id)));
          setHistory(histData);
        }
      } catch (_) {}

      const latestByKpi = {}, allByKpi = {};
      histData.forEach(h => {
        const kid = String(h.kpi_id).trim();
        if (!latestByKpi[kid] || h.week.localeCompare(latestByKpi[kid].week) > 0)
          latestByKpi[kid] = h;
        if (!allByKpi[kid]) allByKpi[kid] = [];
        allByKpi[kid].push(h);
      });

      setKpis(baseKpis.map(k => {
        const kid    = String(k.id).trim();
        const latest = latestByKpi[kid];
        const entries = (allByKpi[kid] || []).sort((a,b) => a.week.localeCompare(b.week));
        if (!latest) return k;

        if (kid === "9") {
          const THRESHOLD = parseFloat(k.target) || 2.61;
          // ── Kaito live override ──
          if (kaitoEnabled && kaito.mindshare?.value !== null && kaito.mindshare?.value !== undefined) {
            const liveVal   = parseFloat(kaito.mindshare.value);
            const liveWeek  = kaito.mindshare.week || "";
            // Injecter W-1 dans l'historique si elle n'y est pas déjà
            const alreadyIn = entries.some(e => e.week === liveWeek);
            const augmented = alreadyIn ? entries : [...entries, { week: liveWeek, kpi_id: kid, value: liveVal }];
            const weeksAbove   = augmented.filter(e => parseFloat(e.value) >= THRESHOLD).length;
            const totalWeeks   = Math.max(augmented.length, 1);
            const progress_pct = weeksAbove / totalWeeks;
            return { ...k, current: Math.round(progress_pct*100), progress_pct,
              status: progress_pct>=1?"Done":"In Progress",
              displayLabel: `${weeksAbove}/${totalWeeks} sem. ≥ ${THRESHOLD}%`,
              latestRaw: `${liveVal.toFixed(2)}% • 🔴 Kaito ${liveWeek}`,
              latestWeek: liveWeek,
              breakdown: kaito.mindshare.detail?.breakdown || [],
              kaitoHistory: augmented };   // ← historique enrichi pour la sparkline
          }
          // ── Fallback Sheets ──
          const weeksAbove   = entries.filter(e => parseFloat(e.value) >= THRESHOLD).length;
          const totalWeeks   = Math.max(entries.length, 1);
          const progress_pct = weeksAbove / totalWeeks;
          return { ...k, current: Math.round(progress_pct*100), progress_pct,
            status: progress_pct>=1?"Done":entries.length>0?"In Progress":"Not Started",
            displayLabel: `${weeksAbove}/${totalWeeks} sem. ≥ ${THRESHOLD}%`,
            latestRaw: parseFloat(latest.value).toFixed(2)+"%" };
        }
        if (kid === "10") {
          // ── Kaito live override ──
          if (kaitoEnabled && kaito.tee_rank?.value !== null && kaito.tee_rank?.value !== undefined) {
            const liveRank  = parseFloat(kaito.tee_rank.value);
            const liveWeek  = kaitoData.tee_rank.week || "";
            const alreadyIn = entries.some(e => e.week === liveWeek);
            const augmented = alreadyIn ? entries : [...entries, { week: liveWeek, kpi_id: kid, value: liveRank }];
            const weeksFirst   = augmented.filter(e => parseFloat(e.value) === 1).length;
            const totalWeeks   = Math.max(augmented.length, 1);
            const progress_pct = weeksFirst / totalWeeks;
            return { ...k, current: Math.round(progress_pct*100), progress_pct,
              status: progress_pct>=1?"Done":"In Progress",
              displayLabel: `${weeksFirst}/${totalWeeks} sem. #1`,
              latestRaw: `Rank #${liveRank} • 🔴 Kaito ${liveWeek}`,
              kaitoHistory: augmented };   // ← historique enrichi pour la sparkline
          }
          // ── Fallback Sheets ──
          const weeksFirst   = entries.filter(e => parseFloat(e.value) === 1).length;
          const totalWeeks   = Math.max(entries.length, 1);
          const progress_pct = weeksFirst / totalWeeks;
          return { ...k, current: Math.round(progress_pct*100), progress_pct,
            status: progress_pct>=1?"Done":entries.length>0?"In Progress":"Not Started",
            displayLabel: `${weeksFirst}/${totalWeeks} sem. #1`,
            latestRaw: `Rank #${parseFloat(latest.value)}` };
        }
        if (kid === "12") {
          const BASELINE = parseFloat(k.baseline) || 0;
          const TARGET   = parseFloat(k.target) || 1;
          const current  = parseFloat(latest.value) || BASELINE;
          const progress_pct = BASELINE < TARGET ? Math.min((current-BASELINE)/(TARGET-BASELINE),1) : 0;
          return { ...k, current, progress_pct,
            status: progress_pct>=1?"Done":current>BASELINE?"In Progress":"Not Started",
            displayLabel: `+${(current-BASELINE).toLocaleString("fr-FR")} followers`,
            latestRaw: `${current.toLocaleString("fr-FR")} followers` };
        }
        const current = parseFloat(latest.value) || 0;
        const target  = parseFloat(k.target) || 0;
        const progress_pct = target > 0 ? Math.min(current/target, 1) : 0;
        return { ...k, current, progress_pct,
          status: progress_pct>=1?"Done":current>0?"In Progress":"Not Started" };
      }));

      setLastSync(new Date().toLocaleTimeString("fr-FR"));
    } catch(e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const iv = setInterval(fetchData, 5*60*1000);
    return () => clearInterval(iv);
  }, []);

  // ── Fetch Airtable quand on switche sur l'onglet performance ──────────────
  useEffect(() => {
    if (activeTab === "performance" && !salesData && !salesLoading) {
      setSalesLoading(true);
      fetchAirtableData().then(d => {
        setSalesData(d);
        setSalesLoading(false);
      }).catch(() => setSalesLoading(false));
    }
  }, [activeTab]);

  const tokenKpi   = buildTokenKpi();
  const allKpis    = [...kpis, tokenKpi];
  const depts      = ["All", ...Object.keys(deptColors)];
  const filtered   = filter === "All" ? allKpis : allKpis.filter(k => k.dept === filter);

  const totalW = kpis.reduce((s,k) => s+parseFloat(k.weight||0), 0);
  const score  = totalW > 0
    ? kpis.reduce((s,k) => s+Math.min(parseFloat(k.progress_pct||0),1)*parseFloat(k.weight||0),0)/totalW
    : 0;

  const doneCount   = kpis.filter(k => k.status==="Done").length;
  const inProgCount = kpis.filter(k => k.status==="In Progress").length;

  const deptStats = Object.keys(deptColors).map(dept => {
    const dk = allKpis.filter(k => k.dept===dept && k.id!=="TOKEN_PERF");
    const dw = dk.reduce((s,k) => s+parseFloat(k.weight||0), 0);
    const s  = dw>0 ? dk.reduce((a,k) => a+Math.min(parseFloat(k.progress_pct||0),1)*parseFloat(k.weight||0),0)/dw : 0;
    const count = allKpis.filter(k => k.dept===dept).length;
    return { dept, score:Math.round(s*100), count, color:deptColors[dept] };
  });

  const week = `S${Math.ceil((new Date()-new Date(new Date().getFullYear(),0,1))/(7*86400000))}`;

  return (
    <div style={{ minHeight:"100vh", background:"#f4f6fa", fontFamily:"'DM Sans','Segoe UI',sans-serif", color:"#1D1D24", padding:"32px 24px" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;700&family=DM+Sans:wght@400;500;600;700&display=swap');
        *{box-sizing:border-box;margin:0}
        ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:#d1d8e0;border-radius:4px}
        button{font-family:inherit}
      `}</style>

      <div style={{ maxWidth:1200, margin:"0 auto" }}>

        {/* Header */}
        <div style={{ background:"#fff", borderBottom:"0.8px solid #d1d8e0", margin:"-32px -24px 32px", padding:"16px 24px", display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:16 }}>
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <circle cx="16" cy="16" r="4.5" fill="#FCD15A"/>
              <circle cx="9" cy="11" r="3.5" fill="#FCD15A" opacity="0.8"/>
              <circle cx="23" cy="11" r="3.5" fill="#FCD15A" opacity="0.8"/>
              <circle cx="9" cy="21" r="3.5" fill="#FCD15A" opacity="0.6"/>
              <circle cx="23" cy="21" r="3.5" fill="#FCD15A" opacity="0.6"/>
              <circle cx="16" cy="6" r="2.5" fill="#FCD15A" opacity="0.5"/>
              <circle cx="16" cy="26" r="2.5" fill="#FCD15A" opacity="0.5"/>
            </svg>
            <div>
            <div style={{ fontSize:11, letterSpacing:"0.12em", color:"#7A8299", fontFamily:"'IBM Plex Mono',monospace", textTransform:"uppercase", marginBottom:6 }}>iExec · Dashboard Stratégique</div>
            <h1 style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:22, fontWeight:700, color:"#1D1D24", letterSpacing:"0.02em", textTransform:"uppercase" }}>
              {activeTab === "kpis" ? "KPI Hebdomadaires" : "Performance · Sales"}
            </h1>
            </div>
          </div>
          <div style={{ display:"flex", gap:10, alignItems:"center", flexWrap:"wrap" }}>
            {lastSync && <div style={{ fontSize:11, color:"#7A8299", fontFamily:"'IBM Plex Mono',monospace" }}>🔄 Sync : {lastSync}</div>}
            <div style={{ fontSize:11, padding:"4px 10px", borderRadius:7, border:"0.8px solid", fontFamily:"'IBM Plex Mono',monospace", ...(
              kaitoStatus === "ok"       ? { color:"#10B981", borderColor:"rgba(16,185,129,0.25)", background:"rgba(16,185,129,0.08)" } :
              kaitoStatus === "loading"  ? { color:"#F59E0B", borderColor:"rgba(245,158,11,0.25)",  background:"rgba(245,158,11,0.08)"  } :
              kaitoStatus === "error"    ? { color:"#EF4444", borderColor:"rgba(239,68,68,0.25)",   background:"rgba(239,68,68,0.08)" } :
                                          { color:"#7A8299", borderColor:"#d1d8e0",  background:"transparent" }
            )}}>
              {kaitoStatus === "ok"      ? `🔴 Kaito ${kaitoData.mindshare?.week ?? ""}` :
               kaitoStatus === "loading" ? "⟳ Kaito..." :
               kaitoStatus === "error"   ? "⚠ Kaito Error" :
                                           "○ Kaito désactivé"}
            </div>
            <button onClick={fetchData} disabled={loading}
              style={{ padding:"8px 16px", background:"#FCD15A", border:"none", borderRadius:7, fontSize:12, color:"#1D1D24", fontWeight:600, cursor:"pointer", fontFamily:"'DM Sans',sans-serif" }}>
              {loading ? "⟳ Chargement..." : "⟳ Actualiser"}
            </button>
            <div style={{ padding:"8px 16px", background:"#fff", border:"0.8px solid #d1d8e0", borderRadius:7, fontSize:12, color:"#1D1D24", fontWeight:500, fontFamily:"'IBM Plex Mono',monospace" }}>
              📅 {week} · 2026
            </div>
          </div>
        </div>

        {/* ── Navigation onglets ── */}
        <div style={{ display:"flex", gap:4, marginBottom:28, borderBottom:"0.8px solid #d1d8e0", paddingBottom:0 }}>
          {[
            { id:"kpis",        label:"01 · KPI Hebdomadaires" },
            { id:"performance", label:"02 · Performance Sales"  },
          ].map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
              padding:"10px 20px", border:"none", background:"transparent",
              fontSize:12, fontFamily:"'IBM Plex Mono',monospace", fontWeight:700,
              color: activeTab === tab.id ? "#1D1D24" : "#7A8299",
              cursor:"pointer", borderBottom: activeTab === tab.id ? "2px solid #FCD15A" : "2px solid transparent",
              marginBottom:"-0.8px", transition:"all 0.15s", letterSpacing:"0.05em",
              textTransform:"uppercase",
            }}>
              {tab.label}
            </button>
          ))}
        </div>

        {error && (
          <div style={{ background:"rgba(239,68,68,0.05)", border:"0.8px solid rgba(239,68,68,0.3)", borderRadius:10, padding:"16px 20px", marginBottom:24, fontSize:12, color:"#EF4444" }}>
            <strong>⚠️ Erreur :</strong> {error}
            <div style={{ color:"#7A8299", marginTop:8 }}>Fichier → Partager → "Toute personne avec le lien" → Lecteur</div>
          </div>
        )}

        {/* ── ONGLET KPI ─────────────────────────────────────────────────── */}
        {activeTab === "kpis" && (<>

        {loading && !error && (
          <div style={{ textAlign:"center", padding:"80px 0", color:"#7A8299" }}>
            <div style={{ fontSize:40, marginBottom:16, animation:"spin 1s linear infinite" }}>⟳</div>
            <div style={{ fontSize:13, fontFamily:"'IBM Plex Mono',monospace" }}>Connexion à Google Sheets...</div>
            <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
          </div>
        )}

        {!loading && !error && kpis.length > 0 && (<>

          {/* Score Banner */}
          <div style={{ background:"#fff", border:"0.8px solid #d1d8e0", borderRadius:10, padding:"28px 32px", marginBottom:24, display:"flex", gap:32, flexWrap:"wrap", alignItems:"center" }}>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:11, letterSpacing:"0.1em", color:"#7A8299", textTransform:"uppercase", marginBottom:8, fontFamily:"'IBM Plex Mono',monospace" }}>Score d'exécution stratégique</div>
              <div style={{ display:"flex", alignItems:"baseline", gap:8 }}>
                <span style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:56, fontWeight:700, color:"#FCD15A", lineHeight:1 }}>{Math.round(score*100)}</span>
                <span style={{ fontSize:24, color:"#d1d8e0" }}>/ 100</span>
              </div>
              <div style={{ marginTop:12, height:6, background:"#f4f6fa", borderRadius:6, overflow:"hidden", maxWidth:400 }}>
                <div style={{ width:`${Math.round(score*100)}%`, height:"100%", background:"linear-gradient(90deg,#FCD15A,#F59E0B)", borderRadius:6, transition:"width 1s ease" }}/>
              </div>
            </div>
            <div style={{ display:"flex", gap:24, flexWrap:"wrap" }}>
              {[
                {label:"Complétés",   value:doneCount,                          color:"#10B981"},
                {label:"En cours",    value:inProgCount,                        color:"#F59E0B"},
                {label:"À démarrer", value:kpis.length-doneCount-inProgCount,  color:"#94A3B8"},
                {label:"Total KPIs", value:kpis.length,                        color:"#FCD15A"},
              ].map(s => (
                <div key={s.label} style={{ textAlign:"center" }}>
                  <div style={{ fontSize:28, fontWeight:700, color:s.color, fontFamily:"'IBM Plex Mono',monospace" }}>{s.value}</div>
                  <div style={{ fontSize:11, color:"#7A8299", marginTop:2 }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Dept stats */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))", gap:12, marginBottom:24 }}>
            {deptStats.filter(d => d.count>0).map(d => (
              <div key={d.dept} onClick={() => setFilter(filter===d.dept?"All":d.dept)}
                style={{ background:filter===d.dept?"rgba(252,209,90,0.08)":"#fff", border:`0.8px solid ${filter===d.dept?d.color:"#d1d8e0"}`, borderRadius:10, padding:"14px 16px", cursor:"pointer", transition:"all 0.2s" }}>
                <div style={{ fontSize:10, color:d.color, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:6, fontFamily:"'IBM Plex Mono',monospace" }}>{d.dept}</div>
                <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:22, fontWeight:700, color:"#1D1D24" }}>
                  {d.dept === "Token" ? (tokenKpi.rank ? `#${tokenKpi.rank}` : "—") : `${d.score}%`}
                </div>
                <div style={{ height:3, background:"#f4f6fa", borderRadius:4, marginTop:8, overflow:"hidden" }}>
                  <div style={{ width:`${d.score}%`, height:"100%", background:d.color, borderRadius:4 }}/>
                </div>
                <div style={{ fontSize:10, color:"#7A8299", marginTop:6 }}>{d.count} KPI{d.count>1?"s":""}</div>
              </div>
            ))}
          </div>

          {/* Filters */}
          <div style={{ display:"flex", gap:8, marginBottom:8, flexWrap:"wrap" }}>
            {depts.map(d => (
              <button key={d} onClick={() => setFilter(d)}
                style={{ padding:"6px 14px", borderRadius:7, fontSize:11, fontWeight:600, border:`0.8px solid ${filter===d?"#FCD15A":"#d1d8e0"}`, background:filter===d?"#FCD15A":"#fff", color:"#1D1D24", cursor:"pointer", transition:"all 0.2s", fontFamily:"'DM Sans',sans-serif" }}>
                {d}
              </button>
            ))}
          </div>
          <div style={{ fontSize:10, color:"#7A8299", marginBottom:20, fontFamily:"'IBM Plex Mono',monospace" }}>Cliquez sur une carte pour voir l'évolution historique</div>

          {/* KPI Grid */}
          {filter === "All" ? (
            <div style={{ display:"flex", flexDirection:"column", gap:32, marginBottom:32 }}>
              {Object.keys(deptColors).map(dept => {
                const dk = allKpis.filter(k => k.dept===dept);
                if (dk.length===0) return null;
                const c = deptColors[dept];
                return (
                  <div key={dept}>
                    <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:14 }}>
                      <div style={{ width:4, height:20, background:c, borderRadius:4 }}/>
                      <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:12, fontWeight:700, color:c, letterSpacing:"0.08em", textTransform:"uppercase" }}>{dept}</div>
                      <div style={{ flex:1, height:"0.8px", background:`linear-gradient(90deg,${c}44,transparent)` }}/>
                      <div style={{ fontSize:11, color:"#7A8299" }}>{dk.length} KPI{dk.length>1?"s":""}</div>
                    </div>
                    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))", gap:14 }}>
                      {dk.map(kpi => <KpiCard key={kpi.id} kpi={kpi} history={history} onOpen={setModal}/>)}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))", gap:14, marginBottom:32 }}>
              {filtered.map(kpi => <KpiCard key={kpi.id} kpi={kpi} history={history} onOpen={setModal}/>)}
            </div>
          )}

        </>)}

        </>)} {/* fin onglet KPI */}

        {/* ── ONGLET PERFORMANCE ─────────────────────────────────────────────── */}
        {activeTab === "performance" && (
          <SalesDashboard data={salesData} loading={salesLoading} />
        )}

        <div style={{ textAlign:"center", marginTop:40, fontSize:10, color:"#b0bec8", letterSpacing:"0.1em", fontFamily:"'IBM Plex Mono',monospace" }}>
          IEXEC · STRATEGIC KPI DASHBOARD · {week} 2026 · DONNÉES LIVE GOOGLE SHEETS · AUTO-REFRESH 5MIN
        </div>
      </div>

      {modal && (
        <KpiModal kpi={modal} history={history} onClose={() => setModal(null)}
          tokenData={tokenData} tokenPeriod={tokenPeriod} setTokenPeriod={setTokenPeriod}/>
      )}
    </div>
  );
}
