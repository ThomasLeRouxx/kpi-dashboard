import { useState, useEffect, useRef } from "react";

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
  try { const r = await fetch("/api/kaito?type=marketing"); return r.ok ? r.json() : null; }
  catch { return null; }
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

function FunnelBar({ data }) {
  const max = Math.max(...data.map(d => d.count), 1);
  const colors = { Identified:"#94A3B8", Researched:"#60A5FA", Contacted:"#3B82F6",
    "Discovery Call":"#FCD15A", "ETHcc meeting":"#F59E0B", "Not Ready Yet":"#F87171", "Not Interested":"#EF4444" };
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
      {data.filter(d => d.count > 0 || ["Contacted","Discovery Call"].includes(d.stage)).map(d => (
        <div key={d.stage} style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ width:90, fontSize:11, color:"#7A8299", textAlign:"right", flexShrink:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{d.stage}</div>
          <div style={{ flex:1, height:18, background:"#f4f6fa", borderRadius:4, overflow:"hidden" }}>
            <div style={{ width:`${(d.count/max)*100}%`, height:"100%", background:colors[d.stage]||"#94A3B8", borderRadius:4, minWidth: d.count > 0 ? 4 : 0, transition:"width 0.6s ease" }}/>
          </div>
          <div style={{ width:24, fontSize:11, fontFamily:"'IBM Plex Mono',monospace", color:"#1D1D24", fontWeight:600, flexShrink:0 }}>{d.count}</div>
        </div>
      ))}
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
  const stageColor = p.stage === "Discovery Call" ? "#FCD15A" : "#F59E0B";
  return (
    <div style={{ background:"#fff", border:`0.8px solid ${stageColor}44`, borderRadius:10, padding:"16px 20px", borderLeft:`3px solid ${stageColor}` }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
        <div>
          <div style={{ fontSize:13, fontWeight:700, color:"#1D1D24" }}>{p.company}</div>
          {p.tvl && p.tvl !== "//" && <div style={{ fontSize:10, color:"#7A8299", marginTop:2 }}>TVL: {p.tvl}</div>}
        </div>
        <div style={{ fontSize:10, padding:"3px 8px", borderRadius:6, background:`${stageColor}22`, color:stageColor, fontFamily:"'IBM Plex Mono',monospace", fontWeight:700 }}>
          {p.stage}
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

// ─── NOUVEAU : Graphe Reach Sales ────────────────────────────────────────────
function ReachChart({ byWeek, byMonth }) {
  const [view, setView] = useState("week");
  const data = view === "week" ? byWeek : byMonth;
  const xKey = view === "week" ? "week" : "month";

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
      {(!data || data.length === 0) ? (
        <div style={{ color:"#7A8299", fontSize:12, padding:"20px 0", textAlign:"center" }}>
          Aucune donnée de reach disponible
        </div>
      ) : (
        <>
          <BarChart data={data} xKey={xKey} yKey="total" color="#3B82F6" height={160} />
          <div style={{ display:"flex", gap:16, marginTop:12, flexWrap:"wrap" }}>
            {[
              { label:"Leads créés", color:"#3B82F6", key:"total" },
              { label:"Réponses",    color:"#8B5CF6", key:"reponse" },
              { label:"Meetings",    color:"#F59E0B", key:"meeting" },
            ].map(s => (
              <div key={s.key} style={{ display:"flex", alignItems:"center", gap:6 }}>
                <div style={{ width:10, height:10, borderRadius:2, background:s.color }}/>
                <span style={{ fontSize:11, color:"#7A8299" }}>
                  {s.label}: <strong style={{ color:"#1D1D24" }}>{data.reduce((acc, d) => acc + (d[s.key]||0), 0)}</strong>
                </span>
              </div>
            ))}
          </div>
          {/* Stacked mini bars réponse + meeting overlay */}
          <div style={{ marginTop:16, display:"flex", gap:4, alignItems:"flex-end" }}>
            {data.map((d, i) => {
              const max = Math.max(...data.map(x => x.total), 1);
              const H = 60;
              const totalH = Math.max((d.total / max) * H, 2);
              const repH = d.total > 0 ? (d.reponse / d.total) * totalH : 0;
              const meetH = d.total > 0 ? (d.meeting / d.total) * totalH : 0;
              return (
                <div key={i} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center" }}>
                  <div style={{ width:"100%", height:H, display:"flex", flexDirection:"column", justifyContent:"flex-end", position:"relative" }}>
                    <div style={{ width:"100%", background:"#3B82F6", height:totalH, borderRadius:"3px 3px 0 0", position:"relative", overflow:"hidden" }}>
                      <div style={{ position:"absolute", bottom:0, width:"100%", height:repH, background:"#8B5CF6" }}/>
                      <div style={{ position:"absolute", bottom:0, width:"100%", height:meetH, background:"#F59E0B" }}/>
                    </div>
                  </div>
                  <div style={{ fontSize:7, color:"#7A8299", fontFamily:"'IBM Plex Mono',monospace", marginTop:2,
                    maxWidth:28, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", textAlign:"center" }}>
                    {String(d[xKey]).replace(/^\d{4}-/, "")}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ─── NOUVEAU : Onglet Marketing Kaito ────────────────────────────────────────
function MarketingDashboard({ data, loading }) {
  if (loading) return (
    <div style={{ textAlign:"center", padding:"80px 0", color:"#7A8299" }}>
      <div style={{ fontSize:40, marginBottom:16 }}>⟳</div>
      <div style={{ fontSize:13, fontFamily:"'IBM Plex Mono',monospace" }}>Chargement Kaito Marketing...</div>
    </div>
  );
  if (!data) return (
    <div style={{ background:"#fff", border:"0.8px solid #d1d8e0", borderRadius:10, padding:"48px 32px", textAlign:"center" }}>
      <div style={{ fontSize:32, marginBottom:16 }}>📡</div>
      <div style={{ fontSize:16, fontWeight:600, color:"#1D1D24", marginBottom:8 }}>Kaito Marketing non disponible</div>
      <div style={{ fontSize:13, color:"#7A8299", fontFamily:"'IBM Plex Mono',monospace" }}>
        Vérifier KAITO_API_KEY dans Vercel → Settings → Environment Variables
      </div>
    </div>
  );

  const sf = data.smartFollowers ?? {};
  const men = data.mentions ?? {};
  const ms = data.mindshare ?? {};
  const tee = data.teeRank ?? {};

  const kpiCards = [
    { label:"Smart Followers", value: sf.count != null ? sf.count.toLocaleString("fr-FR") : "—",
      icon:"🧠", color:"#3B82F6",
      sub: sf.weekly_change != null ? `${sf.weekly_change >= 0 ? "+" : ""}${sf.weekly_change} cette semaine` : sf.handle ? `@${sf.handle}` : "" },
    { label:"Impressions", value: men.impressions != null ? men.impressions.toLocaleString("fr-FR") : "—",
      icon:"👁", color:"#8B5CF6", sub: data.week ?? "" },
    { label:"Mentions RLC", value: men.total != null ? men.total.toLocaleString("fr-FR") : "—",
      icon:"💬", color:"#10B981", sub: `${data.dateRange?.start ?? ""} → ${data.dateRange?.end ?? ""}` },
    { label:"Mindshare RLC", value: ms.value != null ? `${ms.value.toFixed(2)}%` : "—",
      icon:"📊", color:"#FCD15A", sub: `sur ${ms.breakdown?.length ?? 11} tokens Privacy Infra` },
    { label:"Rang TEE", value: tee.rank != null ? `#${tee.rank}` : "—",
      icon:"🏆", color:"#F59E0B", sub: tee.ranking ? tee.ranking.map(r => r.token).join(" · ") : "RLC · ROSE · PHA · SCRT" },
  ];

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:24 }}>

      {/* ── KPI Cards ── */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))", gap:12 }}>
        {kpiCards.map(m => (
          <div key={m.label} style={{ background:"#fff", border:"0.8px solid #d1d8e0", borderRadius:10, padding:"16px 18px" }}>
            <div style={{ fontSize:18, marginBottom:8 }}>{m.icon}</div>
            <div style={{ fontSize:24, fontWeight:700, color:m.color, fontFamily:"'IBM Plex Mono',monospace", lineHeight:1 }}>{m.value}</div>
            <div style={{ fontSize:10, color:"#7A8299", marginTop:6, fontFamily:"'IBM Plex Mono',monospace", textTransform:"uppercase", letterSpacing:"0.08em" }}>{m.label}</div>
            {m.sub && <div style={{ fontSize:10, color:"#7A8299", marginTop:4 }}>{m.sub}</div>}
          </div>
        ))}
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>

        {/* ── Mindshare Treemap ── */}
        {ms.breakdown && ms.breakdown.length > 0 && (
          <div style={{ background:"#fff", border:"0.8px solid #d1d8e0", borderRadius:10, padding:"24px" }}>
            <MindshareTreemap breakdown={ms.breakdown} week={data.week ?? ""} />
            <div style={{ marginTop:16, display:"flex", gap:8, flexWrap:"wrap" }}>
              {ms.breakdown.filter(x => x.value > 0).sort((a,b)=>b.value-a.value).map(x => (
                <div key={x.token} style={{ fontSize:10, fontFamily:"'IBM Plex Mono',monospace", padding:"2px 8px",
                  borderRadius:10, background: x.token === "RLC" ? "#FCD15A22" : "#f4f6fa",
                  color: x.token === "RLC" ? "#92700A" : "#7A8299",
                  border: x.token === "RLC" ? "0.8px solid #FCD15A" : "none", fontWeight: x.token === "RLC" ? 700 : 400 }}>
                  {x.token}: {(ms.total_raw > 0 ? (x.value / ms.total_raw * 100) : 0).toFixed(1)}%
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── TEE Ranking ── */}
        {tee.ranking && tee.ranking.length > 0 && (
          <div style={{ background:"#fff", border:"0.8px solid #d1d8e0", borderRadius:10, padding:"24px" }}>
            <div style={{ fontSize:11, fontFamily:"'IBM Plex Mono',monospace", color:"#7A8299", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:16 }}>
              CLASSEMENT TEE · {data.week ?? ""}
            </div>
            {tee.ranking.map(r => (
              <div key={r.token} style={{ display:"flex", alignItems:"center", gap:12, marginBottom:12, padding:"10px 14px",
                background: r.token === "RLC" ? "#FCD15A11" : "#f9fafb",
                border: r.token === "RLC" ? "0.8px solid #FCD15A55" : "0.8px solid #f0f0f0",
                borderRadius:8 }}>
                <div style={{ fontSize:20, fontFamily:"'IBM Plex Mono',monospace", fontWeight:700,
                  color: r.rank === 1 ? "#FCD15A" : r.rank === 2 ? "#94A3B8" : "#CD7F32" }}>
                  #{r.rank}
                </div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13, fontWeight:700, color:"#1D1D24", fontFamily:"'IBM Plex Mono',monospace" }}>{r.token}</div>
                  {r.mindshare > 0 && <div style={{ fontSize:10, color:"#7A8299" }}>{r.mindshare.toFixed(4)}%</div>}
                </div>
                {r.token === "RLC" && (
                  <div style={{ fontSize:10, fontWeight:700, color:"#FCD15A", background:"#FCD15A22", padding:"2px 8px", borderRadius:6 }}>iExec</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Mentions daily ── */}
      {men.daily && men.daily.length > 0 && (
        <div style={{ background:"#fff", border:"0.8px solid #d1d8e0", borderRadius:10, padding:"24px" }}>
          <div style={{ fontSize:11, fontFamily:"'IBM Plex Mono',monospace", color:"#7A8299", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:16 }}>
            MENTIONS RLC · ÉVOLUTION QUOTIDIENNE
          </div>
          <BarChart data={men.daily} xKey="date" yKey="count" color="#10B981" height={120} />
        </div>
      )}

      <div style={{ fontSize:10, color:"#b0bec8", textAlign:"center", fontFamily:"'IBM Plex Mono',monospace" }}>
        Données Kaito — semaine {data.week ?? ""} · {data.dateRange?.start ?? ""} → {data.dateRange?.end ?? ""}
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
          funnel, byOwner, byVerticale, bySegment, topBlockers, activeProspects,
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
          <FunnelBar data={funnel} />
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

      {/* ── Blockers ── */}
      {topBlockers.length > 0 && (
        <div style={{ background:"#fff", border:"0.8px solid #d1d8e0", borderRadius:10, padding:"24px" }}>
          <div style={{ fontSize:11, fontFamily:"'IBM Plex Mono',monospace", color:"#7A8299", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:16 }}>
            PRINCIPAUX BLOCKERS
          </div>
          <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
            {topBlockers.map(b => (
              <div key={b.name} style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 14px",
                background:"rgba(239,68,68,0.05)", border:"0.8px solid rgba(239,68,68,0.2)", borderRadius:8 }}>
                <span style={{ fontSize:13 }}>⚠</span>
                <span style={{ fontSize:12, color:"#EF4444", fontWeight:600 }}>{b.name}</span>
                <span style={{ fontSize:11, color:"#7A8299", fontFamily:"'IBM Plex Mono',monospace" }}>×{b.count}</span>
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

          {/* Mindshare treemap */}
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
        if (!latest) return k;

        if (kid === "9") {
          // ── Mindshare — Kaito live override ──
          const livems = kd.mindshare;
          if (livems && livems.value != null) {
            const kaitoHistory = [...entries];
            const kaitoWeek = livems.week;
            if (!kaitoHistory.find(h => h.week === kaitoWeek))
              kaitoHistory.push({ week: kaitoWeek, kpi_id:"9", value: livems.value });
            kaitoHistory.sort((a,b) => a.week.localeCompare(b.week));
            const current = parseFloat(livems.value) || 0;
            const target  = parseFloat(k.target) || 2.61;
            const progress_pct = current / target;
            return { ...k, current, progress_pct,
              status: progress_pct >= 1 ? "Done" : current > 0 ? "In Progress" : "Not Started",
              displayLabel: `${current.toFixed(2)}%`,
              latestRaw: `${current.toFixed(4)}% (sur ${livems.detail?.breakdown?.length ?? 11} tokens)`,
              kaitoHistory,
              mindshareBreakdown: livems.detail?.breakdown,
              mindshareWeek: kaitoWeek,
            };
          }
        }

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
          <MarketingDashboard data={marketingData} loading={marketingLoading} />
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
