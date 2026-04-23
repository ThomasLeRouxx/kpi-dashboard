import { useState, useEffect, useRef } from "react";
import Chart from "chart.js/auto";

// ─── API HELPERS ──────────────────────────────────────────────────────────────
async function fetchKaitoStatus() {
  try { const r = await fetch("/api/kaito?type=status"); return r.ok ? r.json() : { enabled: false }; }
  catch { return { enabled: false }; }
}
async function fetchKaitoMindshare() {
  try { const r = await fetch("/api/kaito?type=mindshare"); return r.ok ? r.json() : null; }
  catch { return null; }
}
async function fetchKaitoMarketing() {
  // Lit Weekly_Snapshot via marketing_sheet (KPI-9/10 + SF/ENG si disponibles)
  try {
    const r = await fetch("/api/kaito?type=marketing_sheet");
    return r.ok ? r.json() : null;
  } catch { return null; }
}
async function fetchAirtableData() {
  try { const r = await fetch("/api/airtable?type=status"); return r.ok ? r.json() : null; }
  catch { return null; }
}
async function fetchTokenHistory(coinId, days) {
  try {
    const r = await fetch(`https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=${days}&interval=daily`);
    if (!r.ok) return [];
    const d = await r.json();
    return (d.prices || []).map(([ts, p]) => ({ ts, p }));
  } catch { return []; }
}
function normalize(prices, fromTs) {
  const filtered = prices.filter(x => x.ts >= fromTs);
  if (!filtered.length) return [];
  const base = filtered[0].p;
  return filtered.map(x => ({ ts: x.ts, pct: base > 0 ? ((x.p - base) / base) * 100 : 0 }));
}
function parseCsv(text) {
  const [header, ...rows] = text.trim().split(/\r?\n/);
  const cols = header.split(",");
  return rows.map(r => {
    const vals = r.split(",");
    const obj = {};
    cols.forEach((c, i) => { obj[c.trim()] = vals[i]?.trim() ?? ""; });
    return obj;
  });
}
function col(r, ...keys) {
  for (const k of keys) if (r[k] !== undefined && r[k] !== "") return r[k];
  return "";
}

// ─── GOOGLE SHEETS CONSTANTS ─────────────────────────────────────────────────
const SHEET_ID    = "1Mp8SVYlWw-P6z0ty_JuBEhZtpzqUzMYtBuO9z0knZ4I";
const GID_MASTER  = "377128355";
const GID_HISTORY = "1449053835";
const csvUrl = (gid) =>
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`;

// ─── COLOURS / CONSTANTS ──────────────────────────────────────────────────────
const deptColors = {
  Tech:"#3B82F6", Support:"#10B981", Sales:"#8B5CF6",
  Ecosystem:"#F59E0B", DevRel:"#EF4444", Marketing:"#F59E0B", Token:"#EC4899",
};
const TOKENS = [
  { id:"iexec-rlc",  symbol:"RLC",  color:"#FCD15A" },
  { id:"secret",     symbol:"SCRT", color:"#7C3AED" },
  { id:"pha",        symbol:"PHA",  color:"#10B981" },
  { id:"rose",       symbol:"ROSE", color:"#F43F5E" },
];
// ─── TINY CHART HELPERS ───────────────────────────────────────────────────────
function RadialProgress({ pct, color, size = 52 }) {
  const r = (size - 6) / 2;
  const circ = 2 * Math.PI * r;
  const dash = Math.min(pct / 100, 1) * circ;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#f4f6fa" strokeWidth={5}/>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={5}
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        transform={`rotate(-90 ${size/2} ${size/2})`}/>
    </svg>
  );
}

function Sparkline({ data, color, target }) {
  if (!data || data.length < 2) return null;
  const W = 120; const H = 36;
  const vals = data.map(d => d.pct);
  const min = Math.min(...vals); const max = Math.max(...vals);
  const range = max - min || 1;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * W},${H - ((v - min) / range) * H}`).join(" ");
  const zero = H - ((0 - min) / range) * H;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ overflow:"visible" }}>
      {min < 0 && max > 0 && <line x1={0} y1={zero} x2={W} y2={zero} stroke="#d1d8e0" strokeWidth={0.6} strokeDasharray="2 2"/>}
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round"/>
      <circle cx={(vals.length - 1) / (vals.length - 1) * W} cy={H - ((vals[vals.length-1] - min) / range) * H} r={2.5} fill={color}/>
    </svg>
  );
}

// ─── BAR CHART (générique, utilisé pour reach + funnel marketing) ─────────────
function BarChart({ data, xKey, yKey, color = "#FCD15A", label = "", height = 140 }) {
  if (!data || data.length === 0) return <div style={{ color:"#7A8299", fontSize:12, padding:16 }}>Aucune donnée</div>;
  const max = Math.max(...data.map(d => d[yKey] || 0), 1);
  return (
    <div style={{ display:"flex", alignItems:"flex-end", gap:4, height, paddingTop:8 }}>
      {data.map((d, i) => {
        const h = Math.max(((d[yKey] || 0) / max) * (height - 28), 2);
        return (
          <div key={i} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:2 }}>
            <div style={{ fontSize:9, color:"#7A8299", fontFamily:"'IBM Plex Mono',monospace", textAlign:"center" }}>
              {d[yKey] > 0 ? d[yKey] : ""}
            </div>
            <div style={{ width:"100%", height:h, background:color, borderRadius:"3px 3px 0 0", minWidth:4 }}/>
            <div style={{ fontSize:8, color:"#7A8299", fontFamily:"'IBM Plex Mono',monospace", textAlign:"center",
              maxWidth:36, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
              {String(d[xKey]).replace(/^\d{4}-/, "").replace(/^W/, "W")}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TokenChart({ seriesMap, period, setPeriod }) {
  const W = 520; const H = 180;
  const periods = [{ label:"1S", v:7 },{ label:"1M", v:30 },{ label:"3M", v:90 },{ label:"YTD", v:"ytd" }];
  const allPts = Object.values(seriesMap).flat();
  if (!allPts.length) return null;
  const allPct = allPts.map(p => p.pct);
  const minP = Math.min(...allPct); const maxP = Math.max(...allPct);
  const range = maxP - minP || 1;
  const toSvg = (v) => H - ((v - minP) / range) * H;
  const toX = (i, len) => (i / Math.max(len - 1, 1)) * W;
  return (
    <div>
      <div style={{ display:"flex", gap:6, marginBottom:12 }}>
        {periods.map(p => (
          <button key={p.v} onClick={() => setPeriod(p.v)} style={{
            padding:"4px 10px", borderRadius:6, border:"0.8px solid",
            borderColor: period === p.v ? "#FCD15A" : "#d1d8e0",
            background: period === p.v ? "#FCD15A" : "transparent",
            color: period === p.v ? "#1D1D24" : "#7A8299",
            fontSize:11, cursor:"pointer", fontFamily:"'IBM Plex Mono',monospace", fontWeight:700,
          }}>{p.label}</button>
        ))}
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ overflow:"visible" }}>
        {[-20, -10, 0, 10, 20].map(v => {
          if (v < minP - 5 || v > maxP + 5) return null;
          return (
            <g key={v}>
              <line x1={0} y1={toSvg(v)} x2={W} y2={toSvg(v)} stroke="#f0f0f0" strokeWidth={0.8}/>
              <text x={-4} y={toSvg(v)+4} fontSize={9} fill="#7A8299" textAnchor="end">{v}%</text>
            </g>
          );
        })}
        {Object.entries(seriesMap).map(([sym, pts]) => {
          const token = TOKENS.find(t => t.symbol === sym);
          if (!pts.length) return null;
          const path = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${toX(i, pts.length)} ${toSvg(p.pct)}`).join(" ");
          return <path key={sym} d={path} fill="none" stroke={token?.color ?? "#7A8299"} strokeWidth={1.8} strokeLinejoin="round"/>;
        })}
      </svg>
      <div style={{ display:"flex", gap:16, marginTop:8, flexWrap:"wrap" }}>
        {Object.entries(seriesMap).map(([sym, pts]) => {
          const token = TOKENS.find(t => t.symbol === sym);
          const last = pts[pts.length - 1]?.pct ?? 0;
          return (
            <div key={sym} style={{ display:"flex", alignItems:"center", gap:6 }}>
              <div style={{ width:10, height:10, borderRadius:2, background:token?.color ?? "#7A8299" }}/>
              <span style={{ fontSize:11, fontFamily:"'IBM Plex Mono',monospace", color:"#1D1D24", fontWeight:600 }}>{sym}</span>
              <span style={{ fontSize:11, fontFamily:"'IBM Plex Mono',monospace", color: last >= 0 ? "#10B981" : "#EF4444" }}>
                {last >= 0 ? "+" : ""}{last.toFixed(1)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function squarify(items, x, y, w, h) {
  if (!items.length) return [];
  const total = items.reduce((s, d) => s + d.value, 0);
  const rects = [];
  let remaining = [...items].sort((a, b) => b.value - a.value);
  let cx = x; let cy = y; let cw = w; let ch = h;
  while (remaining.length) {
    const isHoriz = cw >= ch;
    const rowItems = [remaining[0]]; remaining = remaining.slice(1);
    let rowTotal = rowItems[0].value;
    while (remaining.length) {
      const next = remaining[0];
      const testItems = [...rowItems, next];
      const testTotal = rowTotal + next.value;
      const dim = isHoriz ? ch : cw;
      const rowW = (testTotal / total) * (isHoriz ? cw : ch);
      const worstOld = Math.max(...rowItems.map(it => {
        const h2 = (it.value / rowTotal) * dim;
        return Math.max(rowW / h2, h2 / rowW);
      }));
      const rowW2 = (testTotal / total) * (isHoriz ? cw : ch);
      const worstNew = Math.max(...testItems.map(it => {
        const h2 = (it.value / testTotal) * dim;
        return Math.max(rowW2 / h2, h2 / rowW2);
      }));
      if (worstNew <= worstOld) { rowItems.push(next); rowTotal += next.value; remaining = remaining.slice(1); }
      else break;
    }
    const rowFrac = rowTotal / total;
    const rowMainDim = isHoriz ? rowFrac * cw : rowFrac * ch;
    let pos = isHoriz ? cy : cx;
    rowItems.forEach(it => {
      const frac = it.value / rowTotal;
      const crossDim = frac * (isHoriz ? ch : cw);
      const rx = isHoriz ? cx : pos;
      const ry = isHoriz ? pos : cy;
      const rw2 = isHoriz ? rowMainDim : crossDim;
      const rh2 = isHoriz ? crossDim : rowMainDim;
      rects.push({ ...it, x: rx, y: ry, w: rw2, h: rh2 });
      pos += crossDim;
    });
    if (isHoriz) { cx += rowMainDim; cw -= rowMainDim; }
    else         { cy += rowMainDim; ch -= rowMainDim; }
  }
  return rects;
}

function heatColor(t) {
  if (t < 0.05) return "#94A3B8";
  if (t < 0.15) return "#60A5FA";
  if (t < 0.30) return "#3B82F6";
  if (t < 0.50) return "#8B5CF6";
  return "#FCD15A";
}

function MindshareTreemap({ breakdown, week }) {
  const W = 400; const H = 200;
  const total = breakdown.reduce((s, x) => s + x.value, 0);
  const items = breakdown.filter(x => x.value > 0).map(x => ({ ...x, value: x.value }));
  const rects = squarify(items, 0, 0, W, H);
  return (
    <div>
      <div style={{ fontSize:10, color:"#7A8299", fontFamily:"'IBM Plex Mono',monospace", marginBottom:8 }}>
        RÉPARTITION MINDSHARE · {week}
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ borderRadius:8, overflow:"hidden" }}>
        {rects.map((r) => {
          const t = total > 0 ? r.value / total : 0;
          const isRlc = r.token === "RLC";
          return (
            <g key={r.token}>
              <rect x={r.x+1} y={r.y+1} width={Math.max(r.w-2,0)} height={Math.max(r.h-2,0)}
                fill={isRlc ? "#FCD15A" : heatColor(t)} rx={3}/>
              {r.w > 40 && r.h > 20 && (
                <text x={r.x + r.w/2} y={r.y + r.h/2 + (r.h > 30 ? 0 : 4)}
                  textAnchor="middle" fontSize={r.w > 80 ? 10 : 8}
                  fill={isRlc ? "#1D1D24" : "#fff"} fontWeight={isRlc ? 700 : 400} fontFamily="'IBM Plex Mono',monospace">
                  {r.token}
                </text>
              )}
              {r.w > 40 && r.h > 36 && (
                <text x={r.x + r.w/2} y={r.y + r.h/2 + 14}
                  textAnchor="middle" fontSize={8} fill={isRlc ? "#1D1D24" : "rgba(255,255,255,0.7)"} fontFamily="'IBM Plex Mono',monospace">
                  {(t * 100).toFixed(1)}%
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ─── Funnel visuel en entonnoir (barres centrées décroissantes) ───────────────
function FunnelVisual({ data }) {
  const STEP_COLORS = {
    identified: "#94A3B8",
    contacted:  "#3B82F6",
    discovery:  "#8B5CF6",
    qualified:  "#F59E0B",
    advanced:   "#FCD15A",
    lost:       "#EF4444",
  };
  // Largeur max = 100% pour l'étape avec le plus grand count
  const maxCount = Math.max(...data.map(d => d.count), 1);

  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"stretch", gap:3 }}>
      {data.map((step, i) => {
        const color = STEP_COLORS[step.key] || "#94A3B8";
        // Largeur proportionnelle au count, minimum 12% pour les étapes non vides
        const widthPct = step.count > 0 ? Math.max((step.count / maxCount) * 100, 12) : 8;
        const prevStep = i > 0 ? data[i - 1] : null;
        // Taux de conversion depuis l'étape précédente
        const convRate = prevStep && prevStep.count > 0
          ? Math.round((step.count / prevStep.count) * 100) : null;
        const isLight = color === "#FCD15A"; // texte sombre sur fond clair

        return (
          <div key={step.key}>
            {/* Flèche + taux de conversion entre étapes */}
            {convRate !== null && (
              <div style={{ textAlign:"center", fontSize:9, color:"#7A8299", fontFamily:"'IBM Plex Mono',monospace", padding:"2px 0" }}>
                ↓ {convRate}%
              </div>
            )}
            {/* Barre centrée */}
            <div style={{ display:"flex", justifyContent:"center" }}>
              <div style={{
                width:`${widthPct}%`, minWidth:110,
                height:38, background:color, borderRadius:5,
                display:"flex", alignItems:"center", justifyContent:"space-between",
                padding:"0 14px", transition:"width 0.6s ease",
              }}>
                <span style={{ fontSize:10, fontWeight:600, color: isLight ? "#1D1D24" : "#fff",
                  fontFamily:"'IBM Plex Mono',monospace", whiteSpace:"nowrap" }}>
                  {step.label}
                </span>
                <span style={{ fontSize:14, fontWeight:700, color: isLight ? "#1D1D24" : "#fff",
                  fontFamily:"'IBM Plex Mono',monospace" }}>
                  {step.count}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ConversionFlow({ rates, total, totalContacted, totalReponse, totalMeeting, totalDiscovery }) {
  const steps = [
    { label:"Total Leads",  value:total,           pct:100,                          color:"#94A3B8" },
    { label:"Contactés",    value:totalContacted,   pct:rates.identifiedToContacted,  color:"#3B82F6" },
    { label:"Réponses",     value:totalReponse,     pct:rates.contactedToReponse,     color:"#8B5CF6" },
    { label:"Meetings",     value:totalMeeting,     pct:rates.reponseToMeeting,       color:"#F59E0B" },
    { label:"Discovery",    value:totalDiscovery ?? null, pct:rates.meetingToDiscovery, color:"#FCD15A" },
  ];
  return (
    <div style={{ display:"flex", alignItems:"stretch", gap:0, overflowX:"auto" }}>
      {steps.map((s, i) => (
        <div key={s.label} style={{ flex:1, minWidth:80, display:"flex", flexDirection:"column", alignItems:"center" }}>
          <div style={{
            width:"100%", padding:"14px 8px", background:"#fff",
            border:"0.8px solid #d1d8e0", borderRadius:i===0?"10px 0 0 10px":i===steps.length-1?"0 10px 10px 0":"0",
            borderLeft: i>0 ? "none" : "0.8px solid #d1d8e0",
            textAlign:"center", position:"relative",
          }}>
            <div style={{ fontSize:10, color:"#7A8299", fontFamily:"'IBM Plex Mono',monospace", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:6 }}>
              {s.label}
            </div>
            <div style={{ fontSize:22, fontWeight:700, color:s.color, fontFamily:"'IBM Plex Mono',monospace" }}>
              {s.value !== null ? s.value : "—"}
            </div>
            {i > 0 && (
              <div style={{ fontSize:10, color:s.pct >= 50 ? "#10B981" : s.pct >= 25 ? "#F59E0B" : "#EF4444", fontWeight:600, marginTop:4, fontFamily:"'IBM Plex Mono',monospace" }}>
                {s.pct}%
              </div>
            )}
            {i < steps.length - 1 && (
              <div style={{ position:"absolute", right:-12, top:"50%", transform:"translateY(-50%)", zIndex:2, fontSize:16, color:"#d1d8e0" }}>→</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function OwnerCard({ d }) {
  return (
    <div style={{ background:"#fff", border:"0.8px solid #d1d8e0", borderRadius:10, padding:"20px 24px" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
        <div>
          <div style={{ fontSize:13, fontWeight:700, color:"#1D1D24" }}>{d.owner}</div>
          <div style={{ fontSize:11, color:"#7A8299", fontFamily:"'IBM Plex Mono',monospace", marginTop:2 }}>{d.total} leads assignés</div>
        </div>
        <div style={{ display:"flex", gap:16 }}>
          {[
            { label:"Réponse", value:d.tauxRep+"%", color: d.tauxRep >= 30 ? "#10B981" : d.tauxRep >= 15 ? "#F59E0B" : "#EF4444" },
            { label:"Meeting", value:d.tauxMeet+"%", color: d.tauxMeet >= 20 ? "#10B981" : d.tauxMeet >= 10 ? "#F59E0B" : "#EF4444" },
          ].map(m => (
            <div key={m.label} style={{ textAlign:"center" }}>
              <div style={{ fontSize:16, fontWeight:700, color:m.color, fontFamily:"'IBM Plex Mono',monospace" }}>{m.value}</div>
              <div style={{ fontSize:10, color:"#7A8299", fontFamily:"'IBM Plex Mono',monospace" }}>{m.label}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
        {Object.entries(d.stageBreak).filter(([,v]) => v > 0).map(([s, v]) => (
          <div key={s} style={{ fontSize:10, padding:"2px 8px", borderRadius:10, background:"#f4f6fa", color:"#7A8299", fontFamily:"'IBM Plex Mono',monospace" }}>
            {s}: {v}
          </div>
        ))}
      </div>
    </div>
  );
}

function ProspectCard({ p }) {
  // Business Call et Agreement Phase sont des étapes "Advanced"
  const ADVANCED_ALIASES = ["Business Call", "Agreement Phase"];
  const displayStage = ADVANCED_ALIASES.includes(p.stage) ? "Advanced" : p.stage;
  const stageColor = ["Discovery Call", "Advanced", ...ADVANCED_ALIASES].includes(p.stage) ? "#FCD15A" : "#F59E0B";
  return (
    <div style={{ background:"#fff", border:`0.8px solid ${stageColor}44`, borderRadius:10, padding:"16px 20px", borderLeft:`3px solid ${stageColor}` }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
        <div>
          <div style={{ fontSize:13, fontWeight:700, color:"#1D1D24" }}>{p.company}</div>
          {p.tvl && p.tvl !== "//" && <div style={{ fontSize:10, color:"#7A8299", marginTop:2 }}>TVL: {p.tvl}</div>}
        </div>
        <div style={{ fontSize:10, padding:"3px 8px", borderRadius:6, background:`${stageColor}22`, color:stageColor, fontFamily:"'IBM Plex Mono',monospace", fontWeight:700, textAlign:"center" }}>
          {displayStage}
          {displayStage !== p.stage && (
            <div style={{ fontSize:9, color:"#7A8299", fontWeight:400, marginTop:1 }}>{p.stage}</div>
          )}
        </div>
      </div>
      <div style={{ display:"flex", gap:8, flexWrap:"wrap", fontSize:10, color:"#7A8299" }}>
        {p.verticale && <span>🏢 {p.verticale}</span>}
        {p.owner && <span>👤 {p.owner}</span>}
        {p.segment && <span>🎯 {p.segment}</span>}
      </div>
      {p.nextStep && <div style={{ marginTop:8, fontSize:11, color:"#1D1D24", borderTop:"0.8px solid #f4f6fa", paddingTop:8 }}>→ {p.nextStep}</div>}
    </div>
  );
}

// ─── Graphe Reach Sales (graphique linéaire SVG 3 séries) ────────────────────
function ReachChart({ byWeek, byMonth }) {
  const [view, setView] = useState("week");
  const [hovered, setHovered] = useState(null); // { label, color, xLabel, value }
  const data = view === "week" ? byWeek : byMonth;
  const xKey = view === "week" ? "week" : "month";

  const series = [
    { key:"total",   color:"#3B82F6", label:"Leads créés" },
    { key:"reponse", color:"#8B5CF6", label:"Réponses" },
    { key:"meeting", color:"#F59E0B", label:"Meetings" },
  ];

  if (!data || data.length === 0) return (
    <div style={{ background:"#fff", border:"0.8px solid #d1d8e0", borderRadius:10, padding:"24px" }}>
      <div style={{ color:"#7A8299", fontSize:12, padding:"20px 0", textAlign:"center" }}>
        Aucune donnée de reach disponible
      </div>
    </div>
  );

  // Dimensions SVG
  const W = 560; const H = 160;
  const PAD = { top:16, right:20, bottom:36, left:36 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const maxVal = Math.max(...data.flatMap(d => series.map(s => d[s.key] || 0)), 1);
  const toX = (i) => PAD.left + (data.length > 1 ? (i / (data.length - 1)) * innerW : innerW / 2);
  const toY = (v) => PAD.top + (1 - v / maxVal) * innerH;

  // Ticks Y : 0, moitié, max
  const yTicks = [0, Math.ceil(maxVal / 2), maxVal];
  // Labels X : éviter le surpeuplement
  const showEvery = data.length > 10 ? Math.ceil(data.length / 8) : 1;

  return (
    <div style={{ background:"#fff", border:"0.8px solid #d1d8e0", borderRadius:10, padding:"24px" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16, flexWrap:"wrap", gap:8 }}>
        <div style={{ fontSize:11, fontFamily:"'IBM Plex Mono',monospace", color:"#7A8299", textTransform:"uppercase", letterSpacing:"0.1em" }}>
          REACH — NOUVEAUX LEADS
        </div>
        <div style={{ display:"flex", gap:6 }}>
          {[{ v:"week", l:"Par semaine" },{ v:"month", l:"Par mois" }].map(o => (
            <button key={o.v} onClick={() => setView(o.v)} style={{
              padding:"4px 12px", borderRadius:6, border:"0.8px solid",
              borderColor: view === o.v ? "#FCD15A" : "#d1d8e0",
              background: view === o.v ? "#FCD15A" : "transparent",
              color: view === o.v ? "#1D1D24" : "#7A8299",
              fontSize:11, cursor:"pointer", fontFamily:"'IBM Plex Mono',monospace", fontWeight:600,
            }}>{o.l}</button>
          ))}
        </div>
      </div>

      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ overflow:"visible" }}
        onMouseLeave={() => setHovered(null)}>

        {/* Grille Y */}
        {yTicks.map(v => (
          <g key={v}>
            <line x1={PAD.left} y1={toY(v)} x2={W - PAD.right} y2={toY(v)}
              stroke="#f0f2f5" strokeWidth={v === 0 ? 1 : 0.8}/>
            <text x={PAD.left - 6} y={toY(v) + 4} fontSize={9} fill="#b0bec8"
              textAnchor="end" fontFamily="'IBM Plex Mono',monospace">{v}</text>
          </g>
        ))}

        {/* Labels X */}
        {data.map((d, i) => {
          if (i % showEvery !== 0 && i !== data.length - 1) return null;
          const lbl = String(d[xKey]).replace(/^\d{4}-/, "").replace(/^W/, "W");
          return (
            <text key={i} x={toX(i)} y={H - 2} fontSize={8} fill="#b0bec8"
              textAnchor="middle" fontFamily="'IBM Plex Mono',monospace">{lbl}</text>
          );
        })}

        {/* Lignes et points par série */}
        {series.map(s => {
          const pts = data.map((d, i) => `${toX(i)},${toY(d[s.key] || 0)}`).join(" ");
          return (
            <g key={s.key}>
              <polyline points={pts} fill="none" stroke={s.color}
                strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"/>
              {data.map((d, i) => (
                <circle key={i} cx={toX(i)} cy={toY(d[s.key] || 0)} r={3.5}
                  fill={s.color} stroke="#fff" strokeWidth={1.5}
                  style={{ cursor:"pointer" }}
                  onMouseEnter={() => setHovered({
                    label: s.label, color: s.color,
                    xLabel: String(d[xKey]).replace(/^\d{4}-/, ""),
                    value: d[s.key] || 0,
                    cx: toX(i), cy: toY(d[s.key] || 0),
                  })}
                />
              ))}
            </g>
          );
        })}

        {/* Tooltip au hover */}
        {hovered && (
          <g>
            <rect x={hovered.cx - 44} y={hovered.cy - 36} width={88} height={26}
              rx={5} fill="#1D1D24" opacity={0.88}/>
            <text x={hovered.cx} y={hovered.cy - 18} fontSize={10} fill="#fff"
              textAnchor="middle" fontFamily="'IBM Plex Mono',monospace" fontWeight={700}>
              {hovered.xLabel} · {hovered.value}
            </text>
            <text x={hovered.cx} y={hovered.cy - 8} fontSize={8} fill={hovered.color}
              textAnchor="middle" fontFamily="'IBM Plex Mono',monospace">
              {hovered.label}
            </text>
          </g>
        )}
      </svg>

      {/* Légende */}
      <div style={{ display:"flex", gap:20, marginTop:10, flexWrap:"wrap", justifyContent:"center" }}>
        {series.map(s => (
          <div key={s.key} style={{ display:"flex", alignItems:"center", gap:6 }}>
            <div style={{ width:18, height:3, borderRadius:2, background:s.color }}/>
            <span style={{ fontSize:11, color:"#7A8299", fontFamily:"'IBM Plex Mono',monospace" }}>
              {s.label} <strong style={{ color:"#1D1D24" }}>({data.reduce((acc, d) => acc + (d[s.key]||0), 0)})</strong>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── MARKETING DASHBOARD (Google Sheet autonome) ─────────────────────────────
const MKT_SHEET_URL = "/api/marketing-sheet";

// Columns in gid=0 (0-indexed, first column is always empty)
const MKT_COL = {
  week: 1, badge: 2, techAmb: 3, msArbitrum: 4, rankArbitrum: 5,
  netSentiment: 6, msPrivacy: 7, rankPrivacy: 8, teeRanking: 9,
  smartFollowers: 10, smartEngagement: 11, xImpressions: 12,
  likes: 13, engagements: 14, engRate: 15, bookmarks: 16, shares: 17,
  newFollows: 18, unfollows: 19, followers: 20, replies: 22, reposts: 23,
  profileVisits: 24, posts: 25,
};

function mktNum(v) {
  if (v == null || v === "") return null;
  const s = String(v).trim().replace(/,/g, "");
  if (s.endsWith("%")) { const n = parseFloat(s); return isNaN(n) ? null : n / 100; }
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

// Full CSV parser — handles quoted cells with embedded newlines
function parseFullCsv(text) {
  const rows = [];
  let row = [], cell = "", inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuote) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else { inQuote = false; }
      } else { cell += ch; }
    } else {
      if (ch === '"') { inQuote = true; }
      else if (ch === ',') { row.push(cell.trim()); cell = ""; }
      else if (ch === '\r') { /* skip */ }
      else if (ch === '\n') { row.push(cell.trim()); rows.push(row); row = []; cell = ""; }
      else { cell += ch; }
    }
  }
  if (cell !== "" || row.length > 0) { row.push(cell.trim()); rows.push(row); }
  return rows;
}

function parseMarketingCsv(text) {
  const allRows = parseFullCsv(text);
  // Data rows: col[1] matches "Week N"
  const dataRows = allRows.filter(r => /^Week\s+\d+/i.test(r[MKT_COL.week] ?? ""));
  return dataRows;
}


function MktLineChart({ data, color = "#3B82F6", height = 80, secondaryData, secondaryColor = "#F59E0B", refLine = null, labels = [], formatVal }) {
  const [tip, setTip] = useState(null);
  if (!data || data.length === 0) return null;
  const W = 400; const H = height;
  const allVals = [...data, ...(secondaryData ?? [])].filter(v => v != null);
  if (allVals.length === 0) return null;
  const minV = Math.min(...allVals);
  const maxV = Math.max(...allVals);
  const range = maxV - minV || 1;
  const xOf = i => (i / Math.max(data.length - 1, 1)) * W;
  const yOf = v => v == null ? null : H - 4 - ((v - minV) / range) * (H - 12);
  function makePath(series) {
    const segs = []; let moved = false;
    series.forEach((v, i) => {
      const y = yOf(v);
      if (y == null) { moved = false; return; }
      segs.push(`${moved ? "L" : "M"} ${xOf(i).toFixed(1)} ${y.toFixed(1)}`);
      moved = true;
    });
    return segs.join(" ");
  }
  const fmt = formatVal ?? (v => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v % 1 === 0 ? String(v) : v.toFixed(2));
  const refY = refLine != null ? yOf(refLine) : null;
  const zoneW = W / Math.max(data.length, 1);

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H + 4}`} style={{ overflow: "visible" }}
      onMouseLeave={() => setTip(null)}>
      {refY != null && <line x1={0} y1={refY} x2={W} y2={refY} stroke="#94A3B8" strokeWidth={1} strokeDasharray="4 3"/>}
      <path d={makePath(data)} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round"/>
      {secondaryData && <path d={makePath(secondaryData)} fill="none" stroke={secondaryColor} strokeWidth={1.5} strokeLinejoin="round" strokeDasharray="5 3"/>}

      {/* hit zones + dots */}
      {data.map((v, i) => {
        const cx = xOf(i); const cy = yOf(v);
        const v2 = secondaryData?.[i];
        return (
          <g key={i}>
            {cy != null && <circle cx={cx} cy={cy} r={3} fill={color}/>}
            {v2 != null && <circle cx={cx} cy={yOf(v2)} r={2.5} fill={secondaryColor} opacity={0.8}/>}
            <rect x={cx - zoneW / 2} y={0} width={zoneW} height={H}
              fill="transparent" style={{ cursor: "crosshair" }}
              onMouseEnter={() => setTip({ i, x: cx, v, v2 })}/>
          </g>
        );
      })}

      {/* tooltip */}
      {tip != null && (() => {
        const tx = Math.min(Math.max(tip.x, 20), W - 60);
        const lines = [
          tip.v != null ? { txt: fmt(tip.v), col: color } : null,
          tip.v2 != null ? { txt: fmt(tip.v2), col: secondaryColor } : null,
          labels[tip.i] ? { txt: labels[tip.i], col: "#7A8299" } : null,
        ].filter(Boolean);
        const bh = lines.length * 14 + 8;
        const bw = 72;
        const ty = Math.max(4, (yOf(tip.v) ?? 0) - bh - 6);
        return (
          <g pointerEvents="none">
            <rect x={tx - bw/2} y={ty} width={bw} height={bh} rx={4}
              fill="#1D1D24" opacity={0.9}/>
            {lines.map((l, li) => (
              <text key={li} x={tx} y={ty + 13 + li * 14} textAnchor="middle"
                fontSize={10} fill={l.col} fontFamily="'IBM Plex Mono',monospace">{l.txt}</text>
            ))}
          </g>
        );
      })()}
    </svg>
  );
}

function ImpressionsChart({ labels, iexec, techAmb, badges, engagement }) {
  const canvasRef = useRef(null);
  const chartRef  = useRef(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }
    const fmtK = (v) => {
      if (v == null) return "";
      if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(0)}M`;
      if (v >= 1_000) return `${(v / 1_000).toFixed(0)}k`;
      return String(v);
    };
    chartRef.current = new Chart(canvasRef.current.getContext("2d"), {
      type: "line",
      data: {
        labels,
        datasets: [
          { label: "Compte iExec",    data: iexec,      borderColor: "#3B82F6", backgroundColor: "rgba(59,130,246,0.08)",   tension: 0.3, pointRadius: 4, borderWidth: 2,   yAxisID: "y",  spanGaps: false },
          { label: "Tech Ambassadors", data: techAmb,   borderColor: "#8B5CF6", backgroundColor: "rgba(139,92,246,0.08)",  tension: 0.3, pointRadius: 4, borderWidth: 2,   yAxisID: "y",  spanGaps: false },
          { label: "Badge Holders",   data: badges,     borderColor: "#F59E0B", backgroundColor: "rgba(245,158,11,0.08)",  tension: 0.3, pointRadius: 4, borderWidth: 2,   yAxisID: "y",  spanGaps: false },
          { label: "Engagement",      data: engagement, borderColor: "#10B981", backgroundColor: "rgba(16,185,129,0.08)", borderDash: [5, 5], tension: 0.3, pointRadius: 3, borderWidth: 1.5, yAxisID: "y2", spanGaps: false },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        scales: {
          y: {
            position: "left",
            grid: { color: "rgba(0,0,0,0.06)" },
            title: { display: true, text: "Impressions", color: "#7A8299", font: { size: 10, family: "'IBM Plex Mono',monospace" } },
            ticks: { callback: (v) => v >= 1_000_000 ? `${(v/1_000_000).toFixed(0)}M` : v >= 1_000 ? `${(v/1_000).toFixed(0)}k` : v, font: { size: 10 } },
          },
          y2: {
            position: "right",
            grid: { display: false },
            title: { display: true, text: "Engagements", color: "#7A8299", font: { size: 10, family: "'IBM Plex Mono',monospace" } },
            ticks: { callback: (v) => v, font: { size: 10 } },
          },
          x: { ticks: { font: { size: 10, family: "'IBM Plex Mono',monospace" }, color: "#7A8299" }, grid: { display: false } },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const v = ctx.raw;
                if (v == null) return null;
                return `${ctx.dataset.label}: ${ctx.dataset.yAxisID === "y" ? fmtK(v) : v}`;
              },
            },
          },
        },
      },
    });
    return () => { if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; } };
  }, [labels, iexec, techAmb, badges, engagement]);

  const legendItems = [
    { label: "Compte iExec",    color: "#3B82F6", data: iexec,      dashed: false },
    { label: "Tech Ambassadors", color: "#8B5CF6", data: techAmb,   dashed: false },
    { label: "Badge Holders",   color: "#F59E0B", data: badges,     dashed: false },
    { label: "Engagement",      color: "#10B981", data: engagement, dashed: true  },
  ];
  const lastNonNull = (arr) => { for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i]; return null; };
  const fmtLegend = (v, dashed) => {
    if (v == null) return "—";
    if (dashed) return String(Math.round(v));
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `${Math.round(v / 1_000)}k`;
    return String(v);
  };

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginBottom: 12 }}>
        {legendItems.map(d => (
          <div key={d.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {d.dashed
              ? <svg width={20} height={10} style={{ flexShrink: 0 }}><line x1={0} y1={5} x2={20} y2={5} stroke={d.color} strokeWidth={1.5} strokeDasharray="5 3"/></svg>
              : <div style={{ width: 10, height: 10, borderRadius: 2, background: d.color, flexShrink: 0 }}/>}
            <span style={{ fontSize: 10, fontFamily: "'IBM Plex Mono',monospace", color: "#7A8299" }}>
              {d.label} <span style={{ color: "#1D1D24" }}>({fmtLegend(lastNonNull(d.data), d.dashed)})</span>
            </span>
          </div>
        ))}
      </div>
      <div style={{ height: 280, position: "relative" }}>
        <canvas ref={canvasRef}/>
      </div>
    </div>
  );
}

function MarketingDashboard() {
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [rows, setRows]       = useState([]);
  const [msTip, setMsTip]     = useState(null);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(MKT_SHEET_URL);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setRows(parseMarketingCsv(await r.text()));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadData(); }, []);

  if (loading) return (
    <div style={{ textAlign:"center", padding:"80px 0", color:"#7A8299" }}>
      <div style={{ fontSize:40, marginBottom:16 }}>⟳</div>
      <div style={{ fontSize:13, fontFamily:"'IBM Plex Mono',monospace" }}>Chargement Google Sheet Marketing...</div>
    </div>
  );

  if (error) return (
    <div style={{ background:"#FEF2F2", border:"0.8px solid #EF4444", borderRadius:10, padding:"32px", textAlign:"center" }}>
      <div style={{ fontSize:13, color:"#EF4444", marginBottom:12 }}>Erreur de chargement : {error}</div>
      <div style={{ display:"flex", gap:12, justifyContent:"center" }}>
        <a href="https://docs.google.com/spreadsheets/d/1ax7iv9ZINDkhvpDlc_AdofsghKBSfIaO_L54qoHFgV8" target="_blank" rel="noopener noreferrer"
          style={{ fontSize:12, color:"#3B82F6", fontFamily:"'IBM Plex Mono',monospace" }}>Ouvrir le Sheet</a>
        <button onClick={loadData} style={{ fontSize:12, padding:"4px 14px", borderRadius:6, border:"0.8px solid #EF4444", background:"#fff", cursor:"pointer" }}>
          Réessayer
        </button>
      </div>
    </div>
  );

  const C = MKT_COL;
  const get = (row, col) => mktNum(row[col]);

  // Semaines avec données = col[1] non vide et au moins une colonne de données non vide
  const dataRows = rows.filter(r => r[C.week] && (r[C.badge] || r[C.xImpressions] || r[C.engagements]));

  // S1 2026 = Week 1 à Week 26
  const s1Rows = dataRows.filter(r => {
    const m = r[C.week].match(/Week\s+(\d+)/i);
    return m && +m[1] >= 1 && +m[1] <= 26;
  });

  // ── Helpers ──────────────────────────────────────────────────────────────────
  const cardStyle = { background:"#fff", border:"0.8px solid #d1d8e0", borderRadius:10, padding:"20px 24px" };
  const secTitle  = t => (
    <div style={{ fontSize:10, fontFamily:"'IBM Plex Mono',monospace", color:"#7A8299", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:14 }}>{t}</div>
  );
  function fmtNum(n) {
    if (n == null) return "—";
    if (n >= 1_000_000) return `${(n/1_000_000).toFixed(2)}M`;
    if (n >= 1_000) return `${(n/1_000).toFixed(0)}k`;
    return n.toLocaleString("fr-FR");
  }
  function xAxisLabels(arr) {
    const step = Math.ceil(arr.length / 6);
    return arr.filter((_, i) => i % step === 0);
  }

  // ── Section 1 — Mindshare Privacy Infra (col 7, valeurs en %, ex: 0.53 = 0.53%) ──
  const MS_TARGET = 2.61;
  const msVals  = s1Rows.map(r => get(r, C.msPrivacy));
  const msValid = msVals.filter(v => v != null);
  const msAvg   = msValid.length ? msValid.reduce((s,v) => s+v, 0) / msValid.length : 0;
  const msPct   = msValid.length ? msValid.filter(v => v >= MS_TARGET).length / msValid.length * 100 : 0;

  // ── Section 1 — TEE Ranking (col 9, entier 1-4) ──────────────────────────────
  const teeVals  = s1Rows.map(r => { const n = parseInt(r[C.teeRanking]); return isNaN(n) ? null : n; });
  const teeValid = teeVals.filter(v => v != null);
  const teePct   = teeValid.length ? teeValid.filter(v => v === 1).length / teeValid.length * 100 : 0;

  // ── Section 1 — Total Impressions = badge + techAmb + xImp ───────────────────
  const IMP_TARGET = 5000000;
  const sumCol = (col) => s1Rows.reduce((s, r) => s + (get(r, col) ?? 0), 0);
  const badgesImp  = sumCol(C.badge);
  const techAmbImp = sumCol(C.techAmb);
  const iexecImp   = sumCol(C.xImpressions);
  const totalImp   = badgesImp + techAmbImp + iexecImp;
  const impPct     = Math.min(totalImp / IMP_TARGET * 100, 100);

  // ── Section 2 — Engagement ────────────────────────────────────────────────────
  const weekLabels   = dataRows.map(r => r[C.week].replace(/\s*:.*/, "").trim());
  const engVals      = dataRows.map(r => get(r, C.engagements));
  const smartEngVals = dataRows.map(r => get(r, C.smartEngagement));

  // ── Section 3 — Smart Followers ──────────────────────────────────────────────
  const sfVals = dataRows.map(r => get(r, C.smartFollowers));

  // ── Section 4 — Net Sentiment (col 6, valeur "61%" → 0.61 après parsing) ─────
  const sentVals = dataRows.map(r => get(r, C.netSentiment));
  const lastSent = sentVals.filter(v => v != null).at(-1) ?? 0;
  const sentColor = lastSent >= 0.7 ? "#10B981" : lastSent >= 0.5 ? "#F59E0B" : "#EF4444";

  // ── Section 5 — Impressions table (8 dernières semaines) ──────────────────────
  const last8 = dataRows.slice(-8);

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:24 }}>

      {/* Header */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div style={{ fontSize:10, color:"#7A8299", fontFamily:"'IBM Plex Mono',monospace" }}>
          Marketing Analytics · Google Sheet · {s1Rows.length} semaines S1 2026
        </div>
        <button onClick={loadData} style={{ fontSize:11, padding:"5px 14px", borderRadius:6, border:"0.8px solid #d1d8e0", background:"#fff", cursor:"pointer", fontFamily:"'IBM Plex Mono',monospace", color:"#7A8299" }}>
          Rafraîchir
        </button>
      </div>

      {/* ── Section 1 : KPIs S1 2026 ── */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:16 }}>

        {/* Mindshare Privacy Infra */}
        <div style={cardStyle}>
          {secTitle("Mindshare Privacy Infra · S1 2026")}
          <div style={{ fontSize:28, fontWeight:700, fontFamily:"'IBM Plex Mono',monospace", color: msAvg >= MS_TARGET ? "#10B981" : "#EF4444" }}>
            {msAvg.toFixed(2)}%
          </div>
          <div style={{ fontSize:11, color:"#7A8299", margin:"4px 0 14px", fontFamily:"'IBM Plex Mono',monospace" }}>
            Target 2.61% · {msPct.toFixed(0)}% semaines atteintes
          </div>
          {(() => {
            const bSlot = 200 / Math.max(msVals.length, 1);
            return (
              <svg width="100%" viewBox="0 0 200 48" style={{ overflow:"visible" }}
                onMouseLeave={() => setMsTip(null)}>
                {msVals.map((v, i) => {
                  if (v == null) return null;
                  const bw = Math.max(bSlot - 2, 2);
                  const bh = Math.min((v / (MS_TARGET * 3)) * 40, 40);
                  const bx = i * bSlot;
                  return (
                    <g key={i} style={{ cursor:"crosshair" }}
                      onMouseEnter={() => setMsTip({ i, x: bx + bw/2, v })}>
                      <rect x={bx} y={40 - bh} width={bw} height={bh}
                        fill={v >= MS_TARGET ? "#10B981" : "#EF4444"} rx={1} opacity={0.85}/>
                    </g>
                  );
                })}
                <line x1={0} y1={40 - (1/3)*40} x2={200} y2={40 - (1/3)*40}
                  stroke="#FCD15A" strokeWidth={1} strokeDasharray="3 2"/>
                {msTip && (() => {
                  const tx = Math.min(Math.max(msTip.x, 24), 176);
                  const ty = Math.max(2, 40 - Math.min((msTip.v / (MS_TARGET * 3)) * 40, 40) - 30);
                  const label = s1Rows[msTip.i]?.[C.week]?.replace(/\s*:.*/, "").trim() ?? "";
                  return (
                    <g pointerEvents="none">
                      <rect x={tx - 26} y={ty} width={52} height={24} rx={4} fill="#1D1D24" opacity={0.9}/>
                      <text x={tx} y={ty + 10} textAnchor="middle" fontSize={9}
                        fill="#FCD15A" fontFamily="'IBM Plex Mono',monospace">{msTip.v.toFixed(2)}%</text>
                      <text x={tx} y={ty + 21} textAnchor="middle" fontSize={8}
                        fill="#94A3B8" fontFamily="'IBM Plex Mono',monospace">{label}</text>
                    </g>
                  );
                })()}
              </svg>
            );
          })()}
        </div>

        {/* TEE Ranking */}
        <div style={cardStyle}>
          {secTitle("TEE Ranking · S1 2026")}
          <div style={{ fontSize:28, fontWeight:700, fontFamily:"'IBM Plex Mono',monospace", color: teePct >= 50 ? "#10B981" : "#EF4444" }}>
            {teePct.toFixed(0)}%
          </div>
          <div style={{ fontSize:11, color:"#7A8299", margin:"4px 0 14px", fontFamily:"'IBM Plex Mono',monospace" }}>
            Target 50% semaines en #1
          </div>
          <svg width="100%" viewBox="0 0 200 48" style={{ overflow:"visible" }}>
            <line x1={0} y1={24} x2={200} y2={24} stroke="#f0f0f0" strokeWidth={1}/>
            {teeVals.map((v, i) => {
              if (v == null) return null;
              const cx = (i / Math.max(teeVals.length - 1, 1)) * 200;
              const cy = ((v - 1) / 3) * 40 + 4;
              return <circle key={i} cx={cx} cy={cy} r={4} fill={v === 1 ? "#10B981" : v === 2 ? "#FCD15A" : "#EF4444"}/>;
            })}
          </svg>
        </div>

        {/* Total Impressions */}
        <div style={cardStyle}>
          {secTitle("Total Impressions · S1 2026")}
          <div style={{ fontSize:28, fontWeight:700, fontFamily:"'IBM Plex Mono',monospace", color: impPct >= 100 ? "#10B981" : impPct >= 50 ? "#FCD15A" : "#EF4444" }}>
            {fmtNum(totalImp)}
          </div>
          <div style={{ fontSize:11, color:"#7A8299", margin:"4px 0 14px", fontFamily:"'IBM Plex Mono',monospace" }}>
            Target 5M · {impPct.toFixed(1)}% atteint
          </div>
          <div style={{ background:"#f4f6fa", borderRadius:4, height:10, overflow:"hidden", marginBottom:14 }}>
            <div style={{ width:`${impPct}%`, height:"100%", background: impPct >= 100 ? "#10B981" : "#FCD15A", borderRadius:4 }}/>
          </div>
          {[["X / iExec", iexecImp, "#FCD15A"], ["Tech Ambs.", techAmbImp, "#3B82F6"], ["Badges", badgesImp, "#8B5CF6"]].map(([label, val, color]) => (
            <div key={label} style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
              <div style={{ fontSize:9, fontFamily:"'IBM Plex Mono',monospace", color:"#7A8299", width:58 }}>{label}</div>
              <div style={{ flex:1, background:"#f4f6fa", borderRadius:3, height:6 }}>
                <div style={{ width:`${Math.min(val / IMP_TARGET * 100, 100)}%`, height:"100%", background:color, borderRadius:3 }}/>
              </div>
              <div style={{ fontSize:9, fontFamily:"'IBM Plex Mono',monospace", color:"#7A8299", width:46, textAlign:"right" }}>{fmtNum(val)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Section impressions par source ── */}
      <div style={cardStyle}>
        {secTitle("Impressions par source — évolution hebdomadaire")}
        <ImpressionsChart
          labels={dataRows.map(r => r[C.week].replace(/^Week\s+(\d+).*$/, "w.$1"))}
          iexec={dataRows.map(r => get(r, C.xImpressions))}
          techAmb={dataRows.map(r => get(r, C.techAmb))}
          badges={dataRows.map(r => get(r, C.badge))}
          engagement={dataRows.map(r => get(r, C.engagements))}
        />
      </div>

      {/* ── Section 2 : Engagement Twitter ── */}
      <div style={cardStyle}>
        {secTitle("Engagement Twitter · Total vs Smart")}
        <div style={{ display:"flex", gap:20, marginBottom:12 }}>
          <div style={{ display:"flex", alignItems:"center", gap:6 }}>
            <div style={{ width:20, height:3, background:"#3B82F6", borderRadius:2 }}/>
            <span style={{ fontSize:10, fontFamily:"'IBM Plex Mono',monospace", color:"#7A8299" }}>Total Engagements</span>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:6 }}>
            <div style={{ width:20, height:2, borderTop:"2px dashed #F59E0B" }}/>
            <span style={{ fontSize:10, fontFamily:"'IBM Plex Mono',monospace", color:"#7A8299" }}>Smart Engagement</span>
          </div>
        </div>
        <MktLineChart data={engVals} color="#3B82F6" secondaryData={smartEngVals} secondaryColor="#F59E0B" height={80}
          labels={weekLabels} formatVal={v => v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(v)}/>
        <div style={{ display:"flex", justifyContent:"space-between", marginTop:6 }}>
          {xAxisLabels(weekLabels).map((l, i) => (
            <span key={i} style={{ fontSize:8, fontFamily:"'IBM Plex Mono',monospace", color:"#b0bec8" }}>{l}</span>
          ))}
        </div>
      </div>

      {/* ── Section 3 : Smart Followers ── */}
      <div style={cardStyle}>
        {secTitle("Smart Followers · Évolution")}
        <MktLineChart data={sfVals} color="#8B5CF6" height={80} refLine={348}
          labels={weekLabels} formatVal={v => String(Math.round(v))}/>
        <div style={{ display:"flex", justifyContent:"space-between", marginTop:6 }}>
          {xAxisLabels(weekLabels).map((l, i) => (
            <span key={i} style={{ fontSize:8, fontFamily:"'IBM Plex Mono',monospace", color:"#b0bec8" }}>{l}</span>
          ))}
        </div>
        <div style={{ fontSize:10, color:"#94A3B8", marginTop:4, fontFamily:"'IBM Plex Mono',monospace" }}>
          Ligne référence : 348 (valeur actuelle)
        </div>
      </div>

      {/* ── Section 4 : Net Sentiment ── */}
      <div style={cardStyle}>
        {secTitle("Net Sentiment · %")}
        <MktLineChart data={sentVals} color={sentColor} height={80} refLine={0.7}
          labels={weekLabels} formatVal={v => `${(v*100).toFixed(0)}%`}/>
        <div style={{ display:"flex", justifyContent:"space-between", marginTop:6 }}>
          {xAxisLabels(weekLabels).map((l, i) => (
            <span key={i} style={{ fontSize:8, fontFamily:"'IBM Plex Mono',monospace", color:"#b0bec8" }}>{l}</span>
          ))}
        </div>
        <div style={{ fontSize:10, color:"#94A3B8", marginTop:4, fontFamily:"'IBM Plex Mono',monospace" }}>
          Ligne référence : 70% (seuil positif)
        </div>
      </div>

      {/* ── Section 5 : Impressions table ── */}
      <div style={cardStyle}>
        {secTitle("Détail Impressions · 8 dernières semaines")}
        <div style={{ overflowX:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11, fontFamily:"'IBM Plex Mono',monospace" }}>
            <thead>
              <tr style={{ borderBottom:"1px solid #f0f0f0" }}>
                {["Semaine","Total Imp.","X / iExec","Tech Ambs.","Badges","Engagement"].map(h => (
                  <th key={h} style={{ padding:"6px 10px", textAlign: h === "Semaine" ? "left" : "right", color:"#7A8299", fontWeight:400, fontSize:10, whiteSpace:"nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {last8.map((r, i) => {
                const badge = get(r, C.badge) ?? 0;
                const tech  = get(r, C.techAmb) ?? 0;
                const ximp  = get(r, C.xImpressions) ?? 0;
                const total = badge + tech + ximp;
                return (
                  <tr key={i} style={{ borderBottom:"0.5px solid #f8f8f8" }}>
                    <td style={{ padding:"6px 10px", color:"#1D1D24", fontWeight:700, whiteSpace:"nowrap" }}>
                      {r[C.week].replace(/\s*:.*/, "").trim()}
                    </td>
                    <td style={{ padding:"6px 10px", textAlign:"right", color:"#1D1D24" }}>{fmtNum(total || null)}</td>
                    <td style={{ padding:"6px 10px", textAlign:"right", color:"#1D1D24" }}>{fmtNum(get(r, C.xImpressions))}</td>
                    <td style={{ padding:"6px 10px", textAlign:"right", color:"#1D1D24" }}>{fmtNum(get(r, C.techAmb))}</td>
                    <td style={{ padding:"6px 10px", textAlign:"right", color:"#1D1D24" }}>{fmtNum(get(r, C.badge))}</td>
                    <td style={{ padding:"6px 10px", textAlign:"right", color:"#1D1D24" }}>{fmtNum(get(r, C.engagements))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}

// ─── SALES DASHBOARD ──────────────────────────────────────────────────────────
function SalesDashboard({ data, loading }) {
  if (loading) return (
    <div style={{ textAlign:"center", padding:"80px 0", color:"#7A8299" }}>
      <div style={{ fontSize:40, marginBottom:16 }}>⟳</div>
      <div style={{ fontSize:13, fontFamily:"'IBM Plex Mono',monospace" }}>Chargement Airtable...</div>
    </div>
  );
  if (!data || !data.enabled) return (
    <div style={{ background:"#fff", border:"0.8px solid #d1d8e0", borderRadius:10, padding:"48px 32px", textAlign:"center" }}>
      <div style={{ fontSize:32, marginBottom:16 }}>🔌</div>
      <div style={{ fontSize:16, fontWeight:600, color:"#1D1D24", marginBottom:8 }}>Airtable non connecté</div>
      <div style={{ fontSize:13, color:"#7A8299", fontFamily:"'IBM Plex Mono',monospace" }}>
        Ajouter AIRTABLE_API_KEY, AIRTABLE_BASE_ID et AIRTABLE_TABLE_ID dans Vercel → Settings → Environment Variables
      </div>
    </div>
  );

  const { total, totalReponse, totalMeeting, totalDiscovery, conversionRates,
          funnel, byOwner, byVerticale, bySegment, byUsecase = [], topBlockers, activeProspects,
          byWeek = [], byMonth = [] } = data;

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:24 }}>

      {/* ── KPIs rapides ── */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))", gap:12 }}>
        {[
          { label:"Total Leads",     value:total,         icon:"📋", color:"#3B82F6" },
          { label:"Taux Réponse",    value:Math.round(totalReponse/total*100)+"%", icon:"💬", color: Math.round(totalReponse/total*100) >= 25 ? "#10B981" : "#F59E0B" },
          { label:"Taux Meeting",    value:Math.round(totalMeeting/total*100)+"%", icon:"🤝", color: Math.round(totalMeeting/total*100) >= 20 ? "#10B981" : "#F59E0B" },
          { label:"Discovery Calls", value:totalDiscovery ?? activeProspects.length, icon:"🔍", color:"#FCD15A",
            sub: `${totalDiscovery ?? activeProspects.length} actifs` },
          { label:"Réponse→Meeting", value:conversionRates.reponseToMeeting+"%", icon:"📈", color: conversionRates.reponseToMeeting >= 70 ? "#10B981" : "#F59E0B" },
        ].map(m => (
          <div key={m.label} style={{ background:"#fff", border:"0.8px solid #d1d8e0", borderRadius:10, padding:"16px 18px" }}>
            <div style={{ fontSize:18, marginBottom:8 }}>{m.icon}</div>
            <div style={{ fontSize:24, fontWeight:700, color:m.color, fontFamily:"'IBM Plex Mono',monospace", lineHeight:1 }}>{m.value}</div>
            <div style={{ fontSize:10, color:"#7A8299", marginTop:6, fontFamily:"'IBM Plex Mono',monospace", textTransform:"uppercase", letterSpacing:"0.08em" }}>{m.label}</div>
            {m.sub && <div style={{ fontSize:10, color:"#7A8299", marginTop:2 }}>{m.sub}</div>}
          </div>
        ))}
      </div>

      {/* ── Conversion Flow (avec totalDiscovery) ── */}
      <div style={{ background:"#fff", border:"0.8px solid #d1d8e0", borderRadius:10, padding:"24px" }}>
        <div style={{ fontSize:11, fontFamily:"'IBM Plex Mono',monospace", color:"#7A8299", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:16 }}>
          PIPELINE · TAUX DE CONVERSION
        </div>
        <ConversionFlow rates={conversionRates} total={total} totalContacted={data.totalContacted}
          totalReponse={totalReponse} totalMeeting={totalMeeting} totalDiscovery={totalDiscovery} />
      </div>

      {/* ── NOUVEAU : Graphe Reach ── */}
      <ReachChart byWeek={byWeek} byMonth={byMonth} />

      {/* ── Funnel + Verticales ── */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))", gap:16 }}>
        <div style={{ background:"#fff", border:"0.8px solid #d1d8e0", borderRadius:10, padding:"24px" }}>
          <div style={{ fontSize:11, fontFamily:"'IBM Plex Mono',monospace", color:"#7A8299", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:20 }}>
            FUNNEL PAR STAGE
          </div>
          <FunnelVisual data={funnel} />
        </div>

        <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
          {/* Verticales */}
          <div style={{ background:"#fff", border:"0.8px solid #d1d8e0", borderRadius:10, padding:"20px 24px", flex:1 }}>
            <div style={{ fontSize:11, fontFamily:"'IBM Plex Mono',monospace", color:"#7A8299", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:14 }}>
              PAR VERTICALE
            </div>
            {byVerticale.filter(v => v.count > 0).sort((a,b) => b.count-a.count).map(v => (
              <div key={v.verticale} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
                <div style={{ fontSize:12, color:"#1D1D24", fontWeight:500 }}>{v.verticale}</div>
                <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                  <div style={{ width:80, height:6, background:"#f4f6fa", borderRadius:4, overflow:"hidden" }}>
                    <div style={{ width:`${(v.count/total)*100}%`, height:"100%", background:"#FCD15A", borderRadius:4 }}/>
                  </div>
                  <div style={{ fontSize:11, fontFamily:"'IBM Plex Mono',monospace", color:"#7A8299", width:20, textAlign:"right" }}>{v.count}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Segments */}
          <div style={{ background:"#fff", border:"0.8px solid #d1d8e0", borderRadius:10, padding:"20px 24px", flex:1 }}>
            <div style={{ fontSize:11, fontFamily:"'IBM Plex Mono',monospace", color:"#7A8299", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:14 }}>
              PAR SEGMENT
            </div>
            {bySegment.sort((a,b) => b.count-a.count).map(s => (
              <div key={s.segment} style={{ marginBottom:10 }}>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                  <div style={{ fontSize:11, color:"#1D1D24" }}>{s.segment}</div>
                  <div style={{ fontSize:11, fontFamily:"'IBM Plex Mono',monospace", color:"#7A8299" }}>{s.count} · {s.meetings} mtg · {s.discovery} disc</div>
                </div>
                <div style={{ height:4, background:"#f4f6fa", borderRadius:4, overflow:"hidden" }}>
                  <div style={{ width:`${(s.count/total)*100}%`, height:"100%", background:"#3B82F6", borderRadius:4 }}/>
                </div>
              </div>
            ))}
          </div>

          {/* Usecase */}
          {byUsecase.length > 0 && (
            <div style={{ background:"#fff", border:"0.8px solid #d1d8e0", borderRadius:10, padding:"20px 24px", flex:1 }}>
              <div style={{ fontSize:11, fontFamily:"'IBM Plex Mono',monospace", color:"#7A8299", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:14 }}>
                PAR USECASE
              </div>
              {byUsecase.map(u => (
                <div key={u.usecase} style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
                  <div style={{ width:110, fontSize:11, color:"#1D1D24", flexShrink:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{u.usecase || "—"}</div>
                  <div style={{ flex:1, height:16, background:"#f4f6fa", borderRadius:4, overflow:"hidden" }}>
                    <div style={{ width:`${(u.count/total)*100}%`, height:"100%", background:"#8B5CF6", borderRadius:4, minWidth: u.count > 0 ? 4 : 0 }}/>
                  </div>
                  <div style={{ fontSize:11, fontFamily:"'IBM Plex Mono',monospace", color:"#1D1D24", fontWeight:600, width:20, textAlign:"right", flexShrink:0 }}>{u.count}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Par commercial ── */}
      <div>
        <div style={{ fontSize:11, fontFamily:"'IBM Plex Mono',monospace", color:"#7A8299", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:14 }}>
          PERFORMANCE PAR COMMERCIAL
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))", gap:14 }}>
          {byOwner.sort((a,b) => b.total-a.total).map(d => <OwnerCard key={d.owner} d={d} />)}
        </div>
      </div>

      {/* ── Top Prospects ── */}
      <div>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14, flexWrap:"wrap", gap:8 }}>
          <div style={{ fontSize:11, fontFamily:"'IBM Plex Mono',monospace", color:"#7A8299", textTransform:"uppercase", letterSpacing:"0.1em" }}>
            PROSPECTS ACTIFS — DISCOVERY CALLS & MEETINGS
          </div>
          <div style={{ fontSize:11, color:"#FCD15A", fontFamily:"'IBM Plex Mono',monospace", fontWeight:700 }}>
            {activeProspects.length} en cours
          </div>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))", gap:12 }}>
          {activeProspects.map(p => <ProspectCard key={p.company} p={p} />)}
        </div>
      </div>

      {/* ── Blockers (liste ordonnée avec barres de progression) ── */}
      {topBlockers.length > 0 && (
        <div style={{ background:"#fff", border:"0.8px solid #d1d8e0", borderRadius:10, padding:"24px" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
            <div style={{ fontSize:11, fontFamily:"'IBM Plex Mono',monospace", color:"#7A8299", textTransform:"uppercase", letterSpacing:"0.1em" }}>
              PRINCIPAUX BLOCKERS
            </div>
            <div style={{ fontSize:11, fontFamily:"'IBM Plex Mono',monospace", color:"#EF4444", fontWeight:600 }}>
              {topBlockers.length} identifiés
            </div>
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            {topBlockers.slice(0, 6).map((b, i) => {
              const maxCount = topBlockers[0]?.count || 1;
              // Opacité décroissante selon le rang (rouge vif pour le 1er)
              const opacity = 1 - (i / Math.max(topBlockers.length, 1)) * 0.55;
              return (
                <div key={b.name}>
                  <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
                    <span style={{ fontSize:12, color:"#1D1D24", fontWeight:500 }}>{b.name}</span>
                    <span style={{ fontSize:11, fontFamily:"'IBM Plex Mono',monospace", color:"#7A8299" }}>×{b.count}</span>
                  </div>
                  <div style={{ height:6, background:"#f4f6fa", borderRadius:4, overflow:"hidden" }}>
                    <div style={{
                      width:`${(b.count / maxCount) * 100}%`, height:"100%",
                      background:`rgba(239,68,68,${opacity})`, borderRadius:4,
                      transition:"width 0.6s ease",
                    }}/>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── KPI MODAL ────────────────────────────────────────────────────────────────
function KpiModal({ kpi, history, onClose, tokenData, tokenPeriod, setTokenPeriod }) {
  const color    = deptColors[kpi.dept] || "#7A8299";
  const pct      = Math.min(Math.round((kpi.progress_pct || 0) * 100), 100);
  const isMindshare = kpi.id === "9";
  const isToken  = kpi.id === "TOKEN_PERF";
  const statusMap = { Done:{ label:"✓ Complété", color:"#10B981", bg:"rgba(16,185,129,0.08)" },
    "In Progress":{ label:"⟳ En cours", color:"#F59E0B", bg:"rgba(245,158,11,0.08)" },
    "Not Started":{ label:"○ À démarrer", color:"#94A3B8", bg:"rgba(148,163,184,0.08)" } };
  const status = statusMap[kpi.status] || statusMap["Not Started"];

  const fmt = (v, type) => {
    if (v === null || v === undefined) return "—";
    if (type === "Milestone") return v >= 1 ? "✓" : "✗";
    if (type === "Growth" || type === "Ranking") return v;
    return Number(v).toLocaleString("fr-FR");
  };

  const kpiHist = (kpi.kaitoHistory || history
    .filter(h => String(h.kpi_id).trim() === String(kpi.id).trim())
    .sort((a, b) => a.week.localeCompare(b.week)));

  useEffect(() => {
    const fn = (e) => { if (e.key === "Escape") onClose(); };
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
        background:"#fff", border:`0.8px solid #d1d8e0`,
        borderRadius:24, width:"100%", maxWidth: isMindshare ? 760 : 680,
        position:"relative",
        boxShadow:"0 20px 60px rgba(0,0,0,0.12), 0 4px 20px rgba(0,0,0,0.06)",
        overflow:"hidden",
      }}>
        <div style={{ height:3, background:`linear-gradient(90deg,${color},${color}66,transparent)`, width:"100%" }}/>
        <div style={{ padding:"28px 32px 32px" }}>
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
              fontFamily:"inherit", flexShrink:0,
            }}>✕</button>
          </div>

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

          {!isToken && (
            <div style={{ marginBottom:24 }}>
              <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, color:"#7A8299", marginBottom:6, fontFamily:"'IBM Plex Mono',monospace" }}>
                <span>0%</span>
                <span style={{ color }}>{pct}% atteint</span>
                <span>100%</span>
              </div>
              <div style={{ height:8, background:"#f4f6fa", borderRadius:8, overflow:"hidden" }}>
                <div style={{ width:`${pct}%`, height:"100%", background:`linear-gradient(90deg,${color},${color}88)`, borderRadius:8, transition:"width 0.8s ease" }}/>
              </div>
            </div>
          )}

          {/* Historique / Sparkline */}
          {!isToken && kpiHist.length > 0 && !isMindshare && (
            <div style={{ marginBottom:20 }}>
              <div style={{ fontSize:11, color:"#7A8299", marginBottom:10, fontFamily:"'IBM Plex Mono',monospace", textTransform:"uppercase", letterSpacing:"0.08em" }}>
                Évolution historique
              </div>
              <div style={{ display:"flex", gap:6, alignItems:"flex-end", height:60 }}>
                {kpiHist.map((h, i) => {
                  const maxVal = Math.max(...kpiHist.map(x => parseFloat(x.value) || 0), 1);
                  const h2 = Math.max(((parseFloat(h.value) || 0) / maxVal) * 50, 2);
                  return (
                    <div key={i} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:2 }}>
                      <div style={{ fontSize:8, color:"#7A8299", fontFamily:"'IBM Plex Mono',monospace" }}>{parseFloat(h.value) || 0}</div>
                      <div style={{ width:"100%", height:h2, background:color, borderRadius:"2px 2px 0 0", opacity: i === kpiHist.length-1 ? 1 : 0.5 }}/>
                      <div style={{ fontSize:7, color:"#7A8299", fontFamily:"'IBM Plex Mono',monospace", textAlign:"center", maxWidth:28, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                        {String(h.week).replace(/^\d{4}-/, "")}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* KPI-9 : bar chart historique mindshare */}
          {kpi.id === "9" && kpi.kaitoHistory?.length > 0 && (() => {
            const TARGET = 2.61;
            const maxVal = Math.max(...kpi.kaitoHistory.map(h => parseFloat(h.value)), TARGET * 1.2);
            const W = 560; const H = 150; const PAD = 30;
            const barW = Math.max(2, (W - PAD) / kpi.kaitoHistory.length - 3);
            const targetY = H - (TARGET / maxVal) * H;
            return (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize:11, color:"#7A8299", fontFamily:"'IBM Plex Mono',monospace",
                  textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:8 }}>
                  HISTORIQUE MINDSHARE PRIVACY INFRA · RLC
                </div>
                <svg width="100%" viewBox={`0 0 ${W} ${H + PAD}`} style={{ overflow:"visible" }}>
                  <line x1={0} y1={targetY} x2={W} y2={targetY}
                    stroke="#FCD15A" strokeWidth={1} strokeDasharray="4 3"/>
                  <text x={W - 2} y={targetY - 4} fontSize={9}
                    fill="#FCD15A" textAnchor="end" fontFamily="'IBM Plex Mono',monospace">
                    Target 2.61%
                  </text>
                  {kpi.kaitoHistory.map((h, i) => {
                    const val = parseFloat(h.value);
                    const barH = Math.max(2, (val / maxVal) * H);
                    const x = PAD + i * ((W - PAD) / kpi.kaitoHistory.length);
                    const isAbove = val >= TARGET;
                    return (
                      <g key={h.week}>
                        <rect x={x} y={H - barH} width={barW} height={barH}
                          fill={isAbove ? "#10B981" : "#EF4444"} rx={2} opacity={0.85}/>
                        <text x={x + barW/2} y={H - barH - 3} fontSize={8}
                          fill={isAbove ? "#10B981" : "#EF4444"} textAnchor="middle"
                          fontFamily="'IBM Plex Mono',monospace">
                          {val.toFixed(1)}%
                        </text>
                        <text x={x + barW/2} y={H + 12} fontSize={7.5} fill="#7A8299"
                          textAnchor="middle" fontFamily="'IBM Plex Mono',monospace">
                          {h.week.replace("2026-", "")}
                        </text>
                      </g>
                    );
                  })}
                </svg>
                <div style={{ display:"flex", gap:16, marginTop:8, fontSize:11, color:"#7A8299" }}>
                  <span style={{ display:"flex", alignItems:"center", gap:4 }}>
                    <span style={{ width:8, height:8, borderRadius:2, background:"#10B981", display:"inline-block"}}/>
                    {kpi.kaitoHistory.filter(h => parseFloat(h.value) >= 2.61).length} sem. ≥ 2.61%
                  </span>
                  <span style={{ display:"flex", alignItems:"center", gap:4 }}>
                    <span style={{ width:8, height:8, borderRadius:2, background:"#EF4444", display:"inline-block"}}/>
                    {kpi.kaitoHistory.filter(h => parseFloat(h.value) < 2.61).length} sem. &lt; 2.61%
                  </span>
                </div>
              </div>
            );
          })()}

          {/* Mindshare treemap (fallback si mindshareBreakdown disponible) */}
          {isMindshare && kpi.mindshareBreakdown && (
            <div style={{ marginBottom:20 }}>
              <MindshareTreemap breakdown={kpi.mindshareBreakdown} week={kpi.mindshareWeek ?? ""} />
            </div>
          )}

          {/* Token chart */}
          {isToken && (
            <TokenChart seriesMap={tokenData ?? {}} period={tokenPeriod} setPeriod={setTokenPeriod} />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── KPI CARD ─────────────────────────────────────────────────────────────────
function KpiCard({ kpi, history, onOpen }) {
  const color = deptColors[kpi.dept] || "#7A8299";
  const pct   = Math.min(Math.round((kpi.progress_pct || 0) * 100), 100);
  const statusMap = {
    Done:{ label:"✓ Complété", color:"#10B981" },
    "In Progress":{ label:"⟳ En cours", color:"#F59E0B" },
    "Not Started":{ label:"○ À démarrer", color:"#94A3B8" },
  };
  const status = statusMap[kpi.status] || statusMap["Not Started"];
  const isToken = kpi.id === "TOKEN_PERF";

  return (
    <div onClick={() => onOpen(kpi)} style={{
      background:"#fff", border:"0.8px solid #d1d8e0", borderRadius:10, padding:"20px 22px",
      cursor:"pointer", transition:"box-shadow 0.15s, transform 0.15s", position:"relative", overflow:"hidden",
    }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow="0 4px 16px rgba(0,0,0,0.08)"; e.currentTarget.style.transform="translateY(-1px)"; }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow="none"; e.currentTarget.style.transform="none"; }}
    >
      <div style={{ position:"absolute", top:0, left:0, right:0, height:2, background:`linear-gradient(90deg,${color},${color}44,transparent)` }}/>

      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:12 }}>
        <div style={{ flex:1, paddingRight:12 }}>
          <div style={{ display:"flex", gap:6, marginBottom:6 }}>
            <span style={{ fontSize:9, fontWeight:700, letterSpacing:"0.12em", color, textTransform:"uppercase",
              background:`${color}12`, border:`0.8px solid ${color}33`, borderRadius:4, padding:"2px 6px", fontFamily:"'IBM Plex Mono',monospace" }}>
              {kpi.dept}
            </span>
            <span style={{ fontSize:9, color:"#7A8299", letterSpacing:"0.08em", textTransform:"uppercase", fontFamily:"'IBM Plex Mono',monospace" }}>
              {kpi.type}
            </span>
          </div>
          <div style={{ fontSize:13, fontWeight:600, color:"#1D1D24", lineHeight:1.4 }}>{kpi.name}</div>
        </div>
        {isToken ? (
          <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:28, fontWeight:700, color }}>
            {kpi.displayLabel ?? "—"}
          </div>
        ) : (
          <div style={{ position:"relative", width:52, height:52, flexShrink:0 }}>
            {/* Anneau grisé si aucune donnée */}
            <RadialProgress pct={pct} color={kpi.current === 0 && kpi.target === 0 ? "#d1d8e0" : color} size={52}/>
            <div style={{ position:"absolute", top:"50%", left:"50%", transform:"translate(-50%,-50%)",
              fontSize:11, fontWeight:700, fontFamily:"'IBM Plex Mono',monospace",
              color: kpi.current === 0 && kpi.target === 0 ? "#b0bec8" : color }}>
              {kpi.current === 0 && kpi.target === 0 ? "—" : `${pct}%`}
            </div>
          </div>
        )}
      </div>

      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div>
          {kpi.displayLabel && !isToken ? (
            <div style={{ fontSize:12, fontFamily:"'IBM Plex Mono',monospace", color:"#1D1D24", fontWeight:600 }}>{kpi.displayLabel}</div>
          ) : !isToken ? (
            /* Affiche "Pas encore de données" si aucune valeur disponible */
            (kpi.current === 0 && kpi.target === 0) ? (
              <div style={{ fontSize:11, fontFamily:"'IBM Plex Mono',monospace", color:"#b0bec8", fontStyle:"italic" }}>
                Pas encore de données
              </div>
            ) : (
              <div style={{ fontSize:11, fontFamily:"'IBM Plex Mono',monospace", color:"#7A8299" }}>
                {kpi.current ?? 0} / {kpi.target ?? 0}
              </div>
            )
          ) : (
            <div style={{ fontSize:11, fontFamily:"'IBM Plex Mono',monospace", color:"#7A8299" }}>{kpi.latestRaw ?? ""}</div>
          )}
        </div>
        <div style={{ fontSize:10, fontWeight:600, color:status.color, fontFamily:"'IBM Plex Mono',monospace" }}>
          {status.label}
        </div>
      </div>
    </div>
  );
}

// ─── MAIN DASHBOARD ───────────────────────────────────────────────────────────
export default function Dashboard() {
  const [activeTab,    setActiveTab]    = useState("kpis");
  const [kpis,         setKpis]         = useState([]);
  const [history,      setHistory]      = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState(null);
  const [lastSync,     setLastSync]     = useState(null);
  const [modal,        setModal]        = useState(null);
  const [filter,       setFilter]       = useState("All");
  // Sales
  const [salesData,    setSalesData]    = useState(null);
  const [salesLoading, setSalesLoading] = useState(false);
  // Marketing
  const [marketingData,    setMarketingData]    = useState(null);
  const [marketingLoading, setMarketingLoading] = useState(false);
  // Kaito
  const [kaitoEnabled, setKaitoEnabled] = useState(false);
  const [kaitoStatus,  setKaitoStatus]  = useState("disabled");
  const [kaitoData,    setKaitoData]    = useState({});
  // Token chart
  const [tokenData,    setTokenData]    = useState({});
  const [tokenPeriod,  setTokenPeriod]  = useState(90);
  const [tokenLoading, setTokenLoading] = useState(false);

  const ytdStart = new Date(new Date().getUTCFullYear(), 0, 1).getTime();

  // ── Current week label ──────────────────────────────────────────────────────
  const getWeekLabel = () => {
    const now = new Date();
    const thu = new Date(now);
    thu.setUTCDate(now.getUTCDate() + 4 - (now.getUTCDay() || 7));
    const ys = new Date(Date.UTC(thu.getUTCFullYear(), 0, 1));
    return `S${Math.ceil(((thu - ys) / 86400000 + 1) / 7)}`;
  };
  const week = getWeekLabel();

  // ── Fetch Google Sheets KPIs ───────────────────────────────────────────────
  const fetchData = async (kaitoOverride) => {
    setLoading(true); setError(null);
    try {
      const kd = kaitoOverride ?? kaitoData;

      // Timeout 12s pour éviter le chargement infini si Google Sheets ne répond pas
      const fetchWithTimeout = (url, ms = 12000) => {
        const ctrl = new AbortController();
        const id = setTimeout(() => ctrl.abort(), ms);
        return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(id));
      };

      const [resMaster, resHist] = await Promise.all([
        fetchWithTimeout(csvUrl(GID_MASTER)),
        fetchWithTimeout(csvUrl(GID_HISTORY)).catch(() => null),
      ]);

      if (!resMaster.ok) throw new Error(`Google Sheets inaccessible (${resMaster.status})`);

      // Colonnes Sheet : ID, KPI, Département, Type, Target, Baseline, Valeur actuelle, Progression, Statut, Poids
      const masterText = await resMaster.text();
      const masterRows = parseCsv(masterText);
      const baseKpis = masterRows
        .filter(r => col(r, "ID") && !isNaN(parseFloat(col(r, "ID"))))
        .map(r => ({
          id:           col(r, "ID"),
          name:         col(r, "KPI"),
          dept:         col(r, "Département"),
          type:         col(r, "Type"),
          target:       parseFloat(col(r, "Target")) || 0,
          baseline:     parseFloat(col(r, "Baseline")) || 0,
          current:      parseFloat(col(r, "Valeur actuelle")) || 0,
          progress_pct: parseFloat(col(r, "Progression")) || 0,
          status:       col(r, "Statut") || "Not Started",
          weight:       parseFloat(col(r, "Poids")) || 0,
        }));

      // Colonnes Historique : Semaine, Nom du KPI, ID (auto), Valeur, Unité
      let histData = [];
      if (resHist && resHist.ok) {
        const histText = await resHist.text();
        histData = parseCsv(histText)
          .filter(r => { const w = col(r, "Semaine"); return w && /^\d{4}-W\d{2}$/.test(w.trim()); })
          .map(r => ({
            week:   col(r, "Semaine").trim(),
            kpi_id: col(r, "ID (auto)").trim(),
            value:  col(r, "Valeur") || 0,
          }));
        setHistory(histData);
      }

      const latestByKpi = {}; const allByKpi = {};
      histData.forEach(h => {
        const kid = String(h.kpi_id).trim();
        if (!allByKpi[kid]) allByKpi[kid] = [];
        if (!latestByKpi[kid] || h.week.localeCompare(latestByKpi[kid].week) > 0)
          latestByKpi[kid] = h;
        allByKpi[kid].push(h);
      });

      setKpis(baseKpis.map(k => {
        const kid    = String(k.id).trim();
        const latest = latestByKpi[kid];
        const entries = allByKpi[kid] || [];
        // ── KPI-9 : % semaines ≥ 2.61% dans Weekly_Snapshot ────────────────────
        if (kid === "9") {
          const sorted = (allByKpi["9"] || []).sort((a, b) => a.week.localeCompare(b.week));
          const TARGET = 2.61;
          const total  = sorted.length;
          const above  = sorted.filter(h => parseFloat(h.value) >= TARGET).length;
          const progress_pct = total > 0 ? above / total : 0;
          const latestEntry  = sorted[sorted.length - 1];
          const latestVal    = latestEntry ? parseFloat(latestEntry.value) : 0;
          if (total === 0) return { ...k, progress_pct: 0, status: "Not Started",
            displayLabel: "En attente", latestRaw: "Pas encore de données" };
          return { ...k,
            current: above,
            progress_pct,
            status: progress_pct >= 1 ? "Done" : above > 0 ? "In Progress" : "Not Started",
            displayLabel: `${above}/${total} sem. ≥ 2.61%`,
            latestRaw: `Dernière : ${latestVal.toFixed(2)}% · ${latestEntry?.week ?? ""}`,
            kaitoHistory: sorted,
          };
        }

        if (!latest) return k;

        const current = parseFloat(latest.value) || 0;
        const target  = parseFloat(k.target)  || 1;

        if (kid === "10") {
          // TEE Rank — progression inversée (rank 1 = 100%)
          const totalWeeks = entries.length;
          const weeksFirst = entries.filter(h => parseFloat(h.value) === 1).length;
          const progress_pct = totalWeeks > 0 ? weeksFirst / totalWeeks : 0;
          return { ...k, current: Math.round(progress_pct*100), progress_pct,
            status: progress_pct>=1?"Done":entries.length>0?"In Progress":"Not Started",
            displayLabel: `${weeksFirst}/${totalWeeks} sem. #1`,
            latestRaw: `Rank #${parseFloat(latest.value)}` };
        }

        if (kid === "12") {
          // LinkedIn followers — current = valeur brute
          const BASELINE = 5200;
          const progress_pct = Math.max(current - BASELINE, 0) / Math.max(target - BASELINE, 1);
          return { ...k, current, progress_pct,
            status: progress_pct>=1?"Done":current>BASELINE?"In Progress":"Not Started",
            displayLabel: `+${(current-BASELINE).toLocaleString("fr-FR")} followers`,
            latestRaw: `${current.toLocaleString("fr-FR")} followers` };
        }

        // Default
        const progress_pct = target > 0 ? current / target : 0;
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

  // ── Chargement initial des KPIs (toujours, indépendant de Kaito) ───────────
  useEffect(() => { fetchData(); }, []);

  // ── Kaito init — enrichit KPI 9 si disponible ───────────────────────────────
  useEffect(() => {
    fetchKaitoStatus().then(s => {
      setKaitoEnabled(s.enabled);
      if (!s.enabled) { setKaitoStatus("disabled"); return; }
      setKaitoStatus("loading");
      fetchKaitoMindshare().then(data => {
        if (!data) { setKaitoStatus("error"); return; }
        const newKaitoData = { mindshare: data };
        setKaitoData(newKaitoData);
        setKaitoStatus("ok");
        fetchData(newKaitoData); // Re-fetch pour injecter la valeur Kaito dans KPI 9
      });
    });
  }, []);

  // ── Token price chart ──────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setTokenLoading(true);
      try {
        const days = tokenPeriod === "ytd"
          ? Math.ceil((Date.now() - ytdStart) / 86400000) + 1
          : tokenPeriod;
        const results = await Promise.all(
          TOKENS.map(t => fetchTokenHistory(t.id, days).catch(() => []))
        );
        if (cancelled) return;
        const map = {};
        TOKENS.forEach((t, i) => {
          map[t.symbol] = normalize(results[i], tokenPeriod === "ytd" ? ytdStart : 0);
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

  // ── Token KPI builder ──────────────────────────────────────────────────────
  const buildTokenKpi = () => {
    const rlcPrices = tokenData["RLC"] || [];
    const rlcLast   = rlcPrices.length ? rlcPrices[rlcPrices.length-1].pct : null;
    if (rlcLast === null || tokenLoading) {
      return { id:"TOKEN_PERF", name:"Top Performance YTD vs Competitors",
        dept:"Token", type:"Ranking", progress_pct:0, status:"In Progress", weight:0,
        rank:null, displayLabel: tokenLoading ? "⟳" : "—", latestRaw:"" };
    }
    const allLast = TOKENS.map(t => ({
      symbol: t.symbol,
      pct: (tokenData[t.symbol] || []).slice(-1)[0]?.pct ?? -Infinity,
    }));
    const sorted = [...allLast].sort((a,b) => b.pct - a.pct);
    const rank = sorted.findIndex(x => x.symbol === "RLC") + 1;
    const vs = sorted.filter(x => x.symbol !== "RLC").map(x => x.symbol).join("·");
    return { id:"TOKEN_PERF", name:"Top Performance YTD vs Competitors",
      dept:"Token", type:"Ranking", progress_pct: rank === 1 ? 1 : 0, status:"In Progress", weight:0,
      rank, displayLabel:`#${rank}`,
      latestRaw: `#${rank}/${TOKENS.length} · RLC ${rlcLast >= 0 ? "+" : ""}${rlcLast.toFixed(1)}%`,
    };
  };

  // ── Fetch Sales (tab switch) ───────────────────────────────────────────────
  useEffect(() => {
    if (activeTab === "performance" && !salesData) {
      setSalesLoading(true);
      fetchAirtableData().then(d => { setSalesData(d); setSalesLoading(false); });
    }
    if (activeTab === "marketing" && !marketingData) {
      setMarketingLoading(true);
      fetchKaitoMarketing().then(d => { setMarketingData(d); setMarketingLoading(false); });
    }
  }, [activeTab]);

  // ── Computed values ────────────────────────────────────────────────────────
  const tokenKpi   = buildTokenKpi();
  const allKpis    = [...kpis, tokenKpi];
  const depts      = ["All", ...Object.keys(deptColors)];
  const filtered   = filter === "All" ? allKpis : allKpis.filter(k => k.dept === filter);
  const totalW     = allKpis.reduce((s,k) => s + parseFloat(k.weight||0), 0);
  const score      = totalW > 0
    ? allKpis.reduce((s,k) => s + Math.min(parseFloat(k.progress_pct||0),1)*parseFloat(k.weight||0),0)/totalW
    : 0;
  const doneCount  = allKpis.filter(k => k.status === "Done").length;
  const inProgCount = allKpis.filter(k => k.status === "In Progress").length;
  const deptStats  = Object.keys(deptColors).map(dept => {
    const dk = allKpis.filter(k => k.dept === dept);
    const dw = dk.reduce((s,k)=>s+parseFloat(k.weight||0),0);
    const s  = dw > 0 ? dk.reduce((s,k)=>s+Math.min(parseFloat(k.progress_pct||0),1)*parseFloat(k.weight||0),0)/dw : 0;
    return { dept, score:Math.round(s*100), count:dk.length, color:deptColors[dept] };
  });

  const tabTitle = { kpis:"KPI Hebdomadaires", performance:"Performance · Sales", marketing:"Performance · Marketing" };

  return (
    <div style={{ minHeight:"100vh", background:"#f4f6fa", fontFamily:"'DM Sans','Segoe UI',sans-serif", color:"#1D1D24", padding:"32px 24px" }}>
      <style>{`
        *{box-sizing:border-box;margin:0}
        ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:#d1d8e0;border-radius:4px}
        button{font-family:inherit}
        @media(max-width:640px){
          .header-inner{flex-direction:column !important; align-items:flex-start !important; gap:12px !important;}
          .tab-nav{overflow-x:auto !important; padding-bottom:4px;}
          .tab-btn{white-space:nowrap;}
          .dept-grid{grid-template-columns:repeat(2,1fr) !important;}
        }
      `}</style>

      <div style={{ maxWidth:1200, margin:"0 auto" }}>

        {/* ── Header ── */}
        <div style={{ background:"#fff", borderBottom:"0.8px solid #d1d8e0", margin:"-32px -24px 32px", padding:"16px 24px",
          display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:16 }}
          className="header-inner">
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <circle cx="16" cy="16" r="4.5" fill="#FCD15A"/>
              <circle cx="9"  cy="11" r="3.5" fill="#FCD15A" opacity="0.8"/>
              <circle cx="23" cy="11" r="3.5" fill="#FCD15A" opacity="0.8"/>
              <circle cx="9"  cy="21" r="3.5" fill="#FCD15A" opacity="0.6"/>
              <circle cx="23" cy="21" r="3.5" fill="#FCD15A" opacity="0.6"/>
              <circle cx="16" cy="6"  r="2.5" fill="#FCD15A" opacity="0.5"/>
              <circle cx="16" cy="26" r="2.5" fill="#FCD15A" opacity="0.5"/>
            </svg>
            <div>
              <div style={{ fontSize:11, letterSpacing:"0.12em", color:"#7A8299", fontFamily:"'IBM Plex Mono',monospace", textTransform:"uppercase", marginBottom:6 }}>
                iExec · Dashboard Stratégique
              </div>
              <h1 style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:22, fontWeight:700, color:"#1D1D24", letterSpacing:"0.02em", textTransform:"uppercase" }}>
                {tabTitle[activeTab] ?? "KPI Hebdomadaires"}
              </h1>
            </div>
          </div>
          <div style={{ display:"flex", gap:10, alignItems:"center", flexWrap:"wrap" }}>
            {lastSync && <div style={{ fontSize:11, color:"#7A8299", fontFamily:"'IBM Plex Mono',monospace" }}>⏱ Sync : {lastSync}</div>}
            <div style={{ fontSize:11, padding:"4px 10px", borderRadius:7, border:"0.8px solid", fontFamily:"'IBM Plex Mono',monospace", ...({
              ok:      { color:"#10B981", borderColor:"rgba(16,185,129,0.25)", background:"rgba(16,185,129,0.08)" },
              loading: { color:"#F59E0B", borderColor:"rgba(245,158,11,0.25)",  background:"rgba(245,158,11,0.08)"  },
              error:   { color:"#EF4444", borderColor:"rgba(239,68,68,0.25)",   background:"rgba(239,68,68,0.08)" },
              disabled:{ color:"#7A8299", borderColor:"#d1d8e0",                background:"transparent" },
            }[kaitoStatus] ?? { color:"#7A8299", borderColor:"#d1d8e0", background:"transparent" }) }}>
              {kaitoStatus === "ok"      ? `🔴 Kaito ${kaitoData.mindshare?.week ?? ""}` :
               kaitoStatus === "loading" ? "⟳ Kaito..." :
               kaitoStatus === "error"   ? "⚠ Kaito Error" :
               "○ Kaito désactivé"}
            </div>
            <button onClick={() => fetchData()} disabled={loading}
              style={{ padding:"8px 16px", background:"#FCD15A", border:"none", borderRadius:7, fontSize:12, color:"#1D1D24", fontWeight:600, cursor:"pointer" }}>
              {loading ? "⟳ Chargement..." : "⟳ Actualiser"}
            </button>
            <div style={{ padding:"8px 16px", background:"#fff", border:"0.8px solid #d1d8e0", borderRadius:7, fontSize:12, fontFamily:"'IBM Plex Mono',monospace" }}>
              📅 {week} · 2026
            </div>
          </div>
        </div>

        {/* ── Navigation ── */}
        <div style={{ display:"flex", gap:4, marginBottom:28, borderBottom:"0.8px solid #d1d8e0", overflowX:"auto" }} className="tab-nav">
          {[
            { id:"kpis",        label:"01 · KPI Hebdomadaires" },
            { id:"performance", label:"02 · Performance Sales"  },
            { id:"marketing",   label:"03 · Performance Marketing" },
          ].map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} className="tab-btn" style={{
              padding:"10px 20px", border:"none", background:"transparent",
              fontSize:12, fontFamily:"'IBM Plex Mono',monospace", fontWeight:700,
              color: activeTab === tab.id ? "#1D1D24" : "#7A8299",
              cursor:"pointer", borderBottom: activeTab === tab.id ? "2px solid #FCD15A" : "2px solid transparent",
              marginBottom:"-0.8px", transition:"all 0.15s", letterSpacing:"0.05em", textTransform:"uppercase", whiteSpace:"nowrap",
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

        {/* ── ONGLET KPI ── */}
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
                <div style={{ fontSize:11, letterSpacing:"0.1em", color:"#7A8299", textTransform:"uppercase", marginBottom:8, fontFamily:"'IBM Plex Mono',monospace" }}>
                  Score d'exécution stratégique
                </div>
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
                  { label:"Complétés",   value:doneCount,                           color:"#10B981" },
                  { label:"En cours",    value:inProgCount,                         color:"#F59E0B" },
                  { label:"À démarrer", value:allKpis.length-doneCount-inProgCount, color:"#94A3B8" },
                  { label:"Total KPIs", value:allKpis.length,                       color:"#FCD15A" },
                ].map(s => (
                  <div key={s.label} style={{ textAlign:"center" }}>
                    <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:32, fontWeight:700, color:s.color }}>{s.value}</div>
                    <div style={{ fontSize:10, color:"#7A8299", marginTop:4, textTransform:"uppercase", letterSpacing:"0.08em" }}>{s.label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Dept mini cards */}
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))", gap:10, marginBottom:24 }} className="dept-grid">
              {deptStats.map(d => (
                <div key={d.dept} onClick={() => setFilter(filter === d.dept ? "All" : d.dept)} style={{
                  background:"#fff", border:`0.8px solid ${filter===d.dept ? d.color : "#d1d8e0"}`,
                  borderRadius:10, padding:"14px 16px", cursor:"pointer", transition:"border 0.15s",
                }}>
                  <div style={{ fontSize:9, fontWeight:700, letterSpacing:"0.12em", color:d.color, textTransform:"uppercase", marginBottom:6, fontFamily:"'IBM Plex Mono',monospace" }}>{d.dept}</div>
                  <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:22, fontWeight:700, color:d.color }}>{d.score}%</div>
                  <div style={{ fontSize:10, color:"#7A8299", marginTop:4 }}>{d.count} KPIs</div>
                </div>
              ))}
            </div>

            {/* Filter pills */}
            <div style={{ display:"flex", gap:8, marginBottom:16, flexWrap:"wrap" }}>
              {depts.map(d => (
                <button key={d} onClick={() => setFilter(d)} style={{
                  padding:"6px 14px", borderRadius:20, border:"0.8px solid",
                  borderColor: filter===d ? (deptColors[d]||"#FCD15A") : "#d1d8e0",
                  background: filter===d ? (deptColors[d]||"#FCD15A")+"18" : "transparent",
                  color: filter===d ? (deptColors[d]||"#1D1D24") : "#7A8299",
                  fontSize:12, cursor:"pointer", fontFamily:"'DM Sans',sans-serif", fontWeight: filter===d ? 600 : 400,
                }}>{d}</button>
              ))}
            </div>
            <div style={{ fontSize:11, color:"#7A8299", marginBottom:14, fontStyle:"italic" }}>
              Cliquez sur une carte pour voir l'évolution historique
            </div>

            {/* KPI grid — groupé par département */}
            <div style={{ display:"flex", flexDirection:"column", gap:28, marginBottom:32 }}>
              {Object.entries(
                Object.keys(deptColors).reduce((acc, dept) => {
                  const deptKpis = filtered.filter(k => k.dept === dept);
                  if (deptKpis.length > 0) acc[dept] = deptKpis;
                  return acc;
                }, {})
              ).map(([dept, deptKpis]) => (
                <div key={dept}>
                  {/* En-tête de section par domaine */}
                  <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12 }}>
                    <div style={{ width:3, height:18, background:deptColors[dept], borderRadius:2 }}/>
                    <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.14em", color:deptColors[dept], textTransform:"uppercase", fontFamily:"'IBM Plex Mono',monospace" }}>
                      {dept}
                    </div>
                    <div style={{ fontSize:10, color:"#b0bec8", fontFamily:"'IBM Plex Mono',monospace" }}>
                      {deptKpis.length} KPI{deptKpis.length > 1 ? "s" : ""}
                    </div>
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))", gap:14 }}>
                    {deptKpis.map(kpi => (
                      <KpiCard key={kpi.id} kpi={kpi} history={history} onOpen={setModal}/>
                    ))}
                  </div>
                </div>
              ))}
            </div>

          </>)}
        </>)}

        {/* ── ONGLET PERFORMANCE SALES ── */}
        {activeTab === "performance" && (
          <SalesDashboard data={salesData} loading={salesLoading} />
        )}

        {/* ── ONGLET MARKETING ── */}
        {activeTab === "marketing" && (
          <MarketingDashboard />
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
