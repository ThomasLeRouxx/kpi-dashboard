import { useState, useEffect, useRef } from "react";

// ─── CONFIG GOOGLE SHEETS ─────────────────────────────────────────────────────
const SHEET_ID    = "1Mp8SVYlWw-P6z0ty_JuBEhZtpzqUzMYtBuO9z0knZ4I";
const GID_MASTER  = "377128355";
const GID_HISTORY = "1449053835";
const csvUrl = (gid) =>
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`;

// ─── KAITO API (via proxy Vercel /api/kaito) ─────────────────────────────────
// Bascule automatiquement selon la disponibilité du proxy
async function fetchKaitoStatus() {
  try {
    const res = await fetch("/api/kaito?type=status");
    if (!res.ok) return { enabled: false };
    return await res.json();
  } catch { return { enabled: false }; }
}

async function fetchKaitoData(type) {
  const res = await fetch(`/api/kaito?type=${type}`);
  if (!res.ok) throw new Error(`Kaito proxy error ${res.status}`);
  return await res.json();
}

// ─── COINGECKO ────────────────────────────────────────────────────────────────
const TOKENS = [
  { id: "iexec-rlc",    symbol: "RLC",  name: "iExec RLC", color: "#00c2ff", isMain: true  },
  { id: "oasis-network", symbol: "ROSE", name: "Oasis",     color: "#a78bfa", isMain: false },
  { id: "secret",        symbol: "SCRT", name: "Secret",    color: "#34d399", isMain: false },
  { id: "pha",           symbol: "PHA",  name: "Phala",     color: "#f59e0b", isMain: false },
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
  Tech: "#00c2ff", Support: "#a78bfa", Sales: "#34d399",
  Ecosystem: "#f59e0b", DevRel: "#fb7185", Marketing: "#38bdf8",
  Token: "#e879f9",
};
const getColor = (dept) => deptColors[dept] || "#94a3b8";

const statusConfig = {
  "Done":        { label: "✓ Done",       color: "#34d399", bg: "rgba(52,211,153,0.12)"  },
  "In Progress": { label: "⟳ En cours",   color: "#f59e0b", bg: "rgba(245,158,11,0.12)"  },
  "Not Started": { label: "○ À démarrer", color: "#64748b", bg: "rgba(100,116,139,0.12)" },
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
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="5"/>
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
      <div style={{ height:130, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", color:"#334155", fontSize:12, gap:8 }}>
        <span style={{ fontSize:24 }}>📭</span>
        <span>Aucun historique disponible</span>
        <span style={{ fontSize:10, color:"#1e3a5f" }}>Ajoutez des données dans l'onglet Weekly_Snapshot</span>
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
              <line x1={pad.left} y1={y} x2={pad.left+iW} y2={y} stroke="rgba(255,255,255,0.04)" strokeWidth="1"/>
              <text x={pad.left-5} y={y+4} fontSize="8" fill="#334155" textAnchor="end">
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
          <circle key={i} cx={xS(i)} cy={yS(v)} r={tooltip===i?5:3.5} fill={color} stroke="#060d18" strokeWidth="2"
            style={{ cursor:"crosshair", transition:"r 0.15s" }}
            onMouseEnter={() => setTooltip(i)} onMouseLeave={() => setTooltip(null)}/>
        ))}
        {tooltip !== null && (
          <g>
            <line x1={xS(tooltip)} y1={pad.top} x2={xS(tooltip)} y2={pad.top+iH} stroke={color} strokeWidth="1" strokeDasharray="3 3" opacity="0.4"/>
            <rect x={xS(tooltip)-32} y={yS(values[tooltip])-32} width={64} height={22} rx={5} fill="#0a1628" stroke={color} strokeWidth="0.8"/>
            <text x={xS(tooltip)} y={yS(values[tooltip])-17} fontSize="9.5" fill={color} textAnchor="middle" fontWeight="700">
              {values[tooltip]>=1000?(values[tooltip]/1000).toFixed(1)+"K":values[tooltip]}
            </text>
          </g>
        )}
        {weeks.map((w,i) => {
          const show = values.length<=6||i===0||i===weeks.length-1||i%Math.ceil(weeks.length/5)===0;
          return show ? <text key={i} x={xS(i)} y={H-4} fontSize="8" fill="#334155" textAnchor="middle">{w}</text> : null;
        })}
      </svg>
      {tooltip !== null && (
        <div style={{ position:"absolute", bottom:28, left:0, right:0, textAlign:"center", fontSize:9, color:"#475569" }}>
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
      <div style={{ height:160, display:"flex", alignItems:"center", justifyContent:"center", color:"#334155", fontSize:12 }}>
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
            style={{ padding:"4px 12px", borderRadius:6, fontSize:10, fontWeight:600, border:`1px solid ${period===p.days?"#e879f9":"rgba(255,255,255,0.1)"}`, background:period===p.days?"rgba(232,121,249,0.15)":"transparent", color:period===p.days?"#e879f9":"#64748b", cursor:"pointer", transition:"all 0.2s" }}>
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
                stroke={isZero ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.04)"}
                strokeWidth={isZero ? 1.5 : 1} strokeDasharray={isZero ? "none" : "none"}/>
              <text x={pad.left-5} y={y+3} fontSize="7.5" fill="#334155" textAnchor="end">
                {v >= 0 ? "+" : ""}{v.toFixed(0)}%
              </text>
            </g>
          );
        })}

        {/* Zero line label */}
        <text x={pad.left-5} y={zeroY+3} fontSize="7.5" fill="#475569" textAnchor="end">0%</text>

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
          return <circle key={s.symbol} cx={xS(tooltip.idx)} cy={yS(d.pct)} r={3.5} fill={s.color} stroke="#060d18" strokeWidth="1.5"/>;
        })}

        {/* X axis labels */}
        {baseSeries && [0, Math.floor(xCount/2), xCount-1].map(i => {
          const d = baseSeries.data[i];
          if (!d) return null;
          const label = new Date(d.ts).toLocaleDateString("fr-FR", { day:"numeric", month:"short" });
          return <text key={i} x={xS(i)} y={H-4} fontSize="7.5" fill="#334155" textAnchor="middle">{label}</text>;
        })}
      </svg>

      {/* Tooltip box */}
      {tooltip && (
        <div style={{ background:"#0a1628", border:"1px solid rgba(255,255,255,0.1)", borderRadius:8, padding:"8px 12px", fontSize:10, marginTop:4 }}>
          <div style={{ color:"#475569", marginBottom:5, fontSize:9 }}>{tooltip.date}</div>
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

// ─── KPI MODAL ────────────────────────────────────────────────────────────────
function KpiModal({ kpi, history, onClose, tokenData, tokenPeriod, setTokenPeriod }) {
  const color  = getColor(kpi.dept);
  const status = statusConfig[kpi.status] || statusConfig["Not Started"];
  const pct    = Math.round(Math.min(parseFloat(kpi.progress_pct||0)*100, 100));
  const kpiHist = history
    .filter(h => String(h.kpi_id).trim() === String(kpi.id).trim())
    .sort((a,b) => a.week.localeCompare(b.week));
  const isToken = kpi.id === "TOKEN_PERF";

  useEffect(() => {
    const fn = e => { if (e.key==="Escape") onClose(); };
    document.addEventListener("keydown", fn);
    return () => document.removeEventListener("keydown", fn);
  }, [onClose]);

  return (
    <div onClick={onClose}
      style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.8)", backdropFilter:"blur(8px)", zIndex:9999, display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background:"#0a1628", border:`1px solid ${color}44`, borderRadius:20, padding:28, width:"100%", maxWidth:520, position:"relative", boxShadow:`0 32px 80px rgba(0,0,0,0.6), 0 0 0 1px ${color}22` }}>

        <button onClick={onClose}
          style={{ position:"absolute", top:14, right:14, background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:8, width:30, height:30, cursor:"pointer", color:"#94a3b8", fontSize:16, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"inherit" }}>
          ✕
        </button>

        <div style={{ marginBottom:20 }}>
          <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.12em", color, textTransform:"uppercase", marginBottom:6 }}>
            {kpi.dept} · {kpi.type}
          </div>
          <div style={{ fontFamily:"'Space Grotesk',sans-serif", fontSize:17, fontWeight:700, color:"#f8fafc", lineHeight:1.35, marginBottom:14, paddingRight:32 }}>
            {kpi.name}
          </div>

          <div style={{ height:5, background:"rgba(255,255,255,0.05)", borderRadius:6, overflow:"hidden", marginBottom:10 }}>
            <div style={{ width:`${pct}%`, height:"100%", background:`linear-gradient(90deg,${color},${color}88)`, borderRadius:6 }}/>
          </div>

          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <div style={{ fontSize:12, color:"#94a3b8" }}>
              {kpi.displayLabel ? (
                <div>
                  <span style={{ color:"#f8fafc", fontWeight:700, fontSize:17 }}>{kpi.displayLabel}</span>
                  {kpi.latestRaw && <div style={{ fontSize:11, color:"#475569", marginTop:3 }}>{kpi.latestRaw}</div>}
                </div>
              ) : (
                <>
                  <span style={{ color:"#f8fafc", fontWeight:700, fontSize:17 }}>{fmt(kpi.current, kpi.type)}</span>
                  <span style={{ marginLeft:4 }}>/ {fmt(kpi.target, kpi.type)}</span>
                </>
              )}
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              {!isToken && <span style={{ fontFamily:"'Space Grotesk',sans-serif", fontSize:24, fontWeight:700, color }}>{pct}%</span>}
              <div style={{ fontSize:10, fontWeight:700, padding:"3px 10px", borderRadius:20, color:status.color, background:status.bg }}>
                {status.label}
              </div>
            </div>
          </div>
        </div>

        <div style={{ height:1, background:"rgba(255,255,255,0.06)", marginBottom:18 }}/>

        <div>
          {isToken ? (
            <>
              <div style={{ fontSize:10, color:"#475569", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:14 }}>
                📈 Performance relative (base 0% au départ)
              </div>
              <TokenChart seriesMap={tokenData} period={tokenPeriod} setPeriod={setTokenPeriod}/>
            </>
          ) : (
            <>
              <div style={{ fontSize:10, color:"#475569", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:14 }}>
                📈 Évolution hebdomadaire
                {kpiHist.length > 0 && <span style={{ color, marginLeft:8 }}>{kpiHist.length} semaine{kpiHist.length>1?"s":""}</span>}
              </div>
              <Sparkline data={kpiHist} color={color} target={kpi.target}/>
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
        background: hovered ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.03)",
        border: `1px solid ${hovered ? color+"66" : "rgba(255,255,255,0.07)"}`,
        borderRadius:16, padding:"18px 20px", transition:"all 0.22s ease",
        transform: hovered ? "translateY(-2px)" : "translateY(0)",
        boxShadow: hovered ? `0 8px 32px ${color}22` : "none",
        display:"flex", flexDirection:"column", gap:10,
        position:"relative", overflow:"hidden", cursor:"pointer",
      }}>
      <div style={{ position:"absolute", top:0, left:0, width:`${isToken ? 100 : pct}%`, height:2, background:color, borderRadius:"0 2px 0 0", transition:"width 0.8s ease" }}/>

      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:8 }}>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.1em", color, textTransform:"uppercase", marginBottom:4 }}>
            {kpi.dept} · {kpi.type}
          </div>
          <div style={{ fontSize:14, fontWeight:600, color:"#e2e8f0", lineHeight:1.3 }}>{kpi.name}</div>
        </div>
        {isToken ? (
          <div style={{ fontSize:22, fontWeight:800, fontFamily:"'Space Grotesk',sans-serif", color, flexShrink:0 }}>
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
        <div style={{ fontSize:11, color:"#94a3b8" }}>
          {kpi.displayLabel ? (
            <span style={{ color:"#e2e8f0", fontWeight:600 }}>{kpi.displayLabel}</span>
          ) : (
            <>
              <span style={{ color:"#e2e8f0", fontWeight:600 }}>{fmt(kpi.current, kpi.type)}</span>
              <span> / {fmt(kpi.target, kpi.type)}</span>
            </>
          )}
          {kpi.latestRaw && (
            <div style={{ fontSize:10, color:"#475569", marginTop:2 }}>{kpi.latestRaw}</div>
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

  // ── Fetch Kaito data — refresh hebdomadaire (données W-1) ───────────────
  useEffect(() => {
    // Calcule le timestamp du prochain lundi 00:05 (UTC)
    const getMondayRefreshMs = () => {
      const now = new Date();
      const day = now.getUTCDay(); // 0=dim, 1=lun...
      const daysUntilMonday = day === 1 ? 7 : (8 - day) % 7;
      const nextMonday = new Date(Date.UTC(
        now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysUntilMonday,
        0, 5, 0, 0 // 00h05 UTC pour laisser le temps à Kaito de publier
      ));
      return nextMonday.getTime() - now.getTime();
    };

    // Vérifie si on a déjà fetché cette semaine (stocké en mémoire)
    const getCurrentWeekLabel = () => {
      const now = new Date();
      const jan1 = new Date(now.getFullYear(), 0, 1);
      const w = Math.ceil(((now - jan1) / 86400000 + jan1.getDay() + 1) / 7);
      return `${now.getFullYear()}-W${String(w).padStart(2, "0")}`;
    };

    let lastFetchedWeek = null;
    let weeklyTimer = null;

    const loadKaito = async () => {
      const thisWeek = getCurrentWeekLabel();
      if (lastFetchedWeek === thisWeek) return; // déjà fetché cette semaine

      setKaitoStatus("loading");
      const status = await fetchKaitoStatus();
      if (!status.enabled) {
        setKaitoEnabled(false);
        setKaitoStatus("disabled");
        return;
      }
      setKaitoEnabled(true);
      try {
        const [mindshare, teeRank] = await Promise.all([
          fetchKaitoData("mindshare").catch(() => null),
          fetchKaitoData("tee_rank").catch(() => null),
        ]);
        setKaitoData({ mindshare, tee_rank: teeRank });
        setKaitoStatus("ok");
        lastFetchedWeek = thisWeek;

        // Planifie le prochain fetch au lundi suivant
        const msUntilMonday = getMondayRefreshMs();
        weeklyTimer = setTimeout(loadKaito, msUntilMonday);
      } catch {
        setKaitoStatus("error");
      }
    };

    loadKaito();
    return () => { if (weeklyTimer) clearTimeout(weeklyTimer); };
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
  const fetchData = async () => {
    setLoading(true); setError(null);
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
          if (kaitoEnabled && kaitoData.mindshare?.value !== null && kaitoData.mindshare?.value !== undefined) {
            const liveVal = parseFloat(kaitoData.mindshare.value);
            const weeksAbove = entries.filter(e => parseFloat(e.value) >= THRESHOLD).length
              + (liveVal >= THRESHOLD ? 1 : 0); // inclure semaine courante
            const totalWeeks = Math.max(entries.length + 1, 1);
            const progress_pct = weeksAbove / totalWeeks;
            return { ...k, current: Math.round(progress_pct*100), progress_pct,
              status: progress_pct>=1?"Done":"In Progress",
              displayLabel: `${weeksAbove}/${totalWeeks} sem. ≥ ${THRESHOLD}%`,
              latestRaw: `${liveVal.toFixed(2)}% • 🔴 Live Kaito` };
          }
          // ── Fallback Sheets ──
          const weeksAbove = entries.filter(e => parseFloat(e.value) >= THRESHOLD).length;
          const totalWeeks = Math.max(entries.length, 1);
          const progress_pct = weeksAbove / totalWeeks;
          return { ...k, current: Math.round(progress_pct*100), progress_pct,
            status: progress_pct>=1?"Done":entries.length>0?"In Progress":"Not Started",
            displayLabel: `${weeksAbove}/${totalWeeks} sem. ≥ ${THRESHOLD}%`,
            latestRaw: parseFloat(latest.value).toFixed(2)+"%" };
        }
        if (kid === "10") {
          // ── Kaito live override ──
          if (kaitoEnabled && kaitoData.tee_rank?.value !== null && kaitoData.tee_rank?.value !== undefined) {
            const liveRank = parseFloat(kaitoData.tee_rank.value);
            const weeksFirst = entries.filter(e => parseFloat(e.value)===1).length
              + (liveRank === 1 ? 1 : 0);
            const totalWeeks = Math.max(entries.length + 1, 1);
            const progress_pct = weeksFirst / totalWeeks;
            return { ...k, current: Math.round(progress_pct*100), progress_pct,
              status: progress_pct>=1?"Done":"In Progress",
              displayLabel: `${weeksFirst}/${totalWeeks} sem. #1`,
              latestRaw: `Rank #${liveRank} • 🔴 Live Kaito` };
          }
          // ── Fallback Sheets ──
          const weeksFirst = entries.filter(e => parseFloat(e.value)===1).length;
          const totalWeeks = Math.max(entries.length, 1);
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
    <div style={{ minHeight:"100vh", background:"#060d18", fontFamily:"'DM Mono','Courier New',monospace", color:"#e2e8f0", padding:"32px 24px" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Space+Grotesk:wght@400;600;700&display=swap');
        *{box-sizing:border-box;margin:0}
        ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:#1e3a5f;border-radius:4px}
        button{font-family:inherit}
      `}</style>

      {modal && (
        <KpiModal kpi={modal} history={history} onClose={() => setModal(null)}
          tokenData={tokenData} tokenPeriod={tokenPeriod} setTokenPeriod={setTokenPeriod}/>
      )}

      <div style={{ maxWidth:1200, margin:"0 auto" }}>

        {/* Header */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-end", marginBottom:32, flexWrap:"wrap", gap:16 }}>
          <div>
            <div style={{ fontSize:11, letterSpacing:"0.25em", color:"#00c2ff", textTransform:"uppercase", marginBottom:6 }}>iExec · Dashboard Stratégique</div>
            <h1 style={{ fontFamily:"'Space Grotesk',sans-serif", fontSize:28, fontWeight:700, color:"#f8fafc", letterSpacing:"-0.02em" }}>KPI Hebdomadaires</h1>
          </div>
          <div style={{ display:"flex", gap:10, alignItems:"center", flexWrap:"wrap" }}>
            {lastSync && <div style={{ fontSize:11, color:"#475569" }}>🔄 Sync : {lastSync}</div>}
            <div style={{ fontSize:11, padding:"4px 10px", borderRadius:8, border:"1px solid", ...(
              kaitoStatus === "ok"       ? { color:"#34d399", borderColor:"rgba(52,211,153,0.3)", background:"rgba(52,211,153,0.08)" } :
              kaitoStatus === "loading"  ? { color:"#f59e0b", borderColor:"rgba(245,158,11,0.3)",  background:"rgba(245,158,11,0.08)"  } :
              kaitoStatus === "error"    ? { color:"#fb7185", borderColor:"rgba(251,113,133,0.3)", background:"rgba(251,113,133,0.08)" } :
                                          { color:"#475569", borderColor:"rgba(100,116,139,0.2)",  background:"transparent" }
            )}}>
              {kaitoStatus === "ok"      ? `🔴 Kaito ${kaitoData.mindshare?.week ?? ""}` :
               kaitoStatus === "loading" ? "⟳ Kaito..." :
               kaitoStatus === "error"   ? "⚠ Kaito Error" :
                                           "○ Kaito désactivé"}
            </div>
            <button onClick={fetchData} disabled={loading}
              style={{ padding:"8px 16px", background:"rgba(0,194,255,0.08)", border:"1px solid rgba(0,194,255,0.2)", borderRadius:10, fontSize:12, color:"#00c2ff", fontWeight:500, cursor:"pointer" }}>
              {loading ? "⟳ Chargement..." : "⟳ Actualiser"}
            </button>
            <div style={{ padding:"8px 16px", background:"rgba(0,194,255,0.08)", border:"1px solid rgba(0,194,255,0.2)", borderRadius:10, fontSize:12, color:"#00c2ff", fontWeight:500 }}>
              📅 {week} · 2026
            </div>
          </div>
        </div>

        {error && (
          <div style={{ background:"rgba(251,113,133,0.1)", border:"1px solid rgba(251,113,133,0.3)", borderRadius:12, padding:"16px 20px", marginBottom:24, fontSize:12, color:"#fb7185" }}>
            <strong>⚠️ Erreur :</strong> {error}
            <div style={{ color:"#94a3b8", marginTop:8 }}>Fichier → Partager → "Toute personne avec le lien" → Lecteur</div>
          </div>
        )}

        {loading && !error && (
          <div style={{ textAlign:"center", padding:"80px 0", color:"#475569" }}>
            <div style={{ fontSize:40, marginBottom:16, animation:"spin 1s linear infinite" }}>⟳</div>
            <div style={{ fontSize:13 }}>Connexion à Google Sheets...</div>
            <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
          </div>
        )}

        {!loading && !error && kpis.length > 0 && (<>

          {/* Score Banner */}
          <div style={{ background:"linear-gradient(135deg,rgba(0,194,255,0.08),rgba(10,24,46,0.9))", border:"1px solid rgba(0,194,255,0.2)", borderRadius:20, padding:"28px 32px", marginBottom:24, display:"flex", gap:32, flexWrap:"wrap", alignItems:"center" }}>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:11, letterSpacing:"0.15em", color:"#64748b", textTransform:"uppercase", marginBottom:8 }}>Score d'exécution stratégique</div>
              <div style={{ display:"flex", alignItems:"baseline", gap:8 }}>
                <span style={{ fontFamily:"'Space Grotesk',sans-serif", fontSize:56, fontWeight:700, color:"#00c2ff", lineHeight:1 }}>{Math.round(score*100)}</span>
                <span style={{ fontSize:24, color:"#00c2ff44" }}>/ 100</span>
              </div>
              <div style={{ marginTop:12, height:6, background:"rgba(255,255,255,0.05)", borderRadius:6, overflow:"hidden", maxWidth:400 }}>
                <div style={{ width:`${Math.round(score*100)}%`, height:"100%", background:"linear-gradient(90deg,#00c2ff,#38bdf8)", borderRadius:6, transition:"width 1s ease" }}/>
              </div>
            </div>
            <div style={{ display:"flex", gap:24, flexWrap:"wrap" }}>
              {[
                {label:"Complétés",   value:doneCount,                          color:"#34d399"},
                {label:"En cours",    value:inProgCount,                        color:"#f59e0b"},
                {label:"À démarrer", value:kpis.length-doneCount-inProgCount,  color:"#64748b"},
                {label:"Total KPIs", value:kpis.length,                        color:"#00c2ff"},
              ].map(s => (
                <div key={s.label} style={{ textAlign:"center" }}>
                  <div style={{ fontSize:28, fontWeight:700, color:s.color, fontFamily:"'Space Grotesk',sans-serif" }}>{s.value}</div>
                  <div style={{ fontSize:11, color:"#475569", marginTop:2 }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Dept stats */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))", gap:12, marginBottom:24 }}>
            {deptStats.filter(d => d.count>0).map(d => (
              <div key={d.dept} onClick={() => setFilter(filter===d.dept?"All":d.dept)}
                style={{ background:filter===d.dept?"rgba(255,255,255,0.08)":"rgba(255,255,255,0.03)", border:`1px solid ${filter===d.dept?d.color+"55":"rgba(255,255,255,0.06)"}`, borderRadius:12, padding:"14px 16px", cursor:"pointer", transition:"all 0.2s" }}>
                <div style={{ fontSize:10, color:d.color, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:6 }}>{d.dept}</div>
                <div style={{ fontFamily:"'Space Grotesk',sans-serif", fontSize:22, fontWeight:700, color:"#f8fafc" }}>
                  {d.dept === "Token" ? (tokenKpi.rank ? `#${tokenKpi.rank}` : "—") : `${d.score}%`}
                </div>
                <div style={{ height:3, background:"rgba(255,255,255,0.05)", borderRadius:4, marginTop:8, overflow:"hidden" }}>
                  <div style={{ width:`${d.score}%`, height:"100%", background:d.color, borderRadius:4 }}/>
                </div>
                <div style={{ fontSize:10, color:"#475569", marginTop:6 }}>{d.count} KPI{d.count>1?"s":""}</div>
              </div>
            ))}
          </div>

          {/* Filters */}
          <div style={{ display:"flex", gap:8, marginBottom:8, flexWrap:"wrap" }}>
            {depts.map(d => (
              <button key={d} onClick={() => setFilter(d)}
                style={{ padding:"6px 14px", borderRadius:8, fontSize:11, fontWeight:600, border:`1px solid ${filter===d?"#00c2ff":"rgba(255,255,255,0.1)"}`, background:filter===d?"rgba(0,194,255,0.15)":"transparent", color:filter===d?"#00c2ff":"#64748b", cursor:"pointer", transition:"all 0.2s" }}>
                {d}
              </button>
            ))}
          </div>
          <div style={{ fontSize:10, color:"#1e3a5f", marginBottom:20 }}>Cliquez sur une carte pour voir l'évolution historique</div>

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
                      <div style={{ fontFamily:"'Space Grotesk',sans-serif", fontSize:13, fontWeight:700, color:c, letterSpacing:"0.08em", textTransform:"uppercase" }}>{dept}</div>
                      <div style={{ flex:1, height:1, background:`linear-gradient(90deg,${c}33,transparent)` }}/>
                      <div style={{ fontSize:11, color:"#475569" }}>{dk.length} KPI{dk.length>1?"s":""}</div>
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

        <div style={{ textAlign:"center", marginTop:24, fontSize:10, color:"#1e3a5f", letterSpacing:"0.1em" }}>
          IEXEC · STRATEGIC KPI DASHBOARD · {week} 2026 · DONNÉES LIVE GOOGLE SHEETS · AUTO-REFRESH 5MIN
        </div>
      </div>
    </div>
  );
}
