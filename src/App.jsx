import { useState, useEffect } from "react";

// ─── CONFIGURATION GOOGLE SHEETS ──────────────────────────────────────────────
// Pour que ça fonctionne, rendez le Sheet public :
// Fichier → Partager → "Toute personne avec le lien" → Lecteur
const SHEET_ID = "1WVO-QNNA7ldjAdi7dMoUUCwloBta6BeFVApaStdo0NU";
const GID_MASTER = "70523329";

const csvUrl = (gid) =>
  //`https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`
  'https://docs.google.com/spreadsheets/d/1WVO-QNNA7ldjAdi7dMoUUCwloBta6BeFVApaStdo0NU/edit?usp=sharing';

// ─── CSV PARSER ────────────────────────────────────────────────────────────────
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

// ─── DESIGN TOKENS ────────────────────────────────────────────────────────────
const deptColors = {
  Tech: "#00c2ff", Support: "#a78bfa", Sales: "#34d399",
  Ecosystem: "#f59e0b", DevRel: "#fb7185", Marketing: "#38bdf8",
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
  if (["Revenue", "Cumulative", "Impressions"].includes(type))
    return n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1000 ? (n / 1000).toFixed(0) + "K" : n;
  return n;
};

// ─── RADIAL PROGRESS ──────────────────────────────────────────────────────────
function RadialProgress({ pct, color, size = 52 }) {
  const r = size / 2 - 6, circ = 2 * Math.PI * r;
  const dash = (Math.min(pct, 100) / 100) * circ;
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="5"/>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth="5"
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        style={{ transition: "stroke-dasharray 0.8s cubic-bezier(0.4,0,0.2,1)" }}/>
    </svg>
  );
}

// ─── KPI CARD ─────────────────────────────────────────────────────────────────
function KpiCard({ kpi }) {
  const [hovered, setHovered] = useState(false);
  const color  = getColor(kpi.dept);
  const status = statusConfig[kpi.status] || statusConfig["Not Started"];
  const pct    = Math.round(Math.min(parseFloat(kpi.progress_pct || 0) * 100, 100));

  return (
    <div onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.03)",
        border: `1px solid ${hovered ? color + "55" : "rgba(255,255,255,0.07)"}`,
        borderRadius: 16, padding: "18px 20px", transition: "all 0.25s ease",
        transform: hovered ? "translateY(-2px)" : "translateY(0)",
        boxShadow: hovered ? `0 8px 32px ${color}22` : "none",
        display: "flex", flexDirection: "column", gap: 10,
        position: "relative", overflow: "hidden",
      }}>
      {/* progress bar top */}
      <div style={{ position: "absolute", top: 0, left: 0, width: `${pct}%`, height: 2, background: color, borderRadius: "0 2px 0 0", transition: "width 0.8s ease" }}/>
      
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", color, textTransform: "uppercase", marginBottom: 4 }}>
            {kpi.dept} · {kpi.type}
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#e2e8f0", lineHeight: 1.3 }}>{kpi.name}</div>
        </div>
        <div style={{ position: "relative", flexShrink: 0 }}>
          <RadialProgress pct={pct} color={color}/>
          <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", fontSize: 10, fontWeight: 700, color }}>
            {pct}%
          </div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 11, color: "#94a3b8" }}>
          <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{fmt(kpi.current, kpi.type)}</span>
          <span> / {fmt(kpi.target, kpi.type)}</span>
        </div>
        <div style={{ fontSize: 10, fontWeight: 700, padding: "3px 9px", borderRadius: 20, color: status.color, background: status.bg, letterSpacing: "0.04em" }}>
          {status.label}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <div style={{ fontSize: 10, color: "#475569" }}>Poids stratégique</div>
        <div style={{ flex: 1, height: 3, background: "rgba(255,255,255,0.05)", borderRadius: 4, overflow: "hidden" }}>
          <div style={{ width: `${(parseFloat(kpi.weight || 0) / 15) * 100}%`, height: "100%", background: color + "88", borderRadius: 4 }}/>
        </div>
        <div style={{ fontSize: 10, color, fontWeight: 700 }}>{kpi.weight}%</div>
      </div>
    </div>
  );
}

// ─── MAIN DASHBOARD ───────────────────────────────────────────────────────────
export default function Dashboard() {
  const [kpis,     setKpis]     = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);
  const [filter,   setFilter]   = useState("All");
  const [lastSync, setLastSync] = useState(null);

  const fetchData = async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(csvUrl(GID_MASTER));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const rows = parseCsv(text);

      const mapped = rows.map(r => ({
        id:           r["KPI_ID"]        || r[Object.keys(r)[0]],
        name:         r["KPI_Name"]      || r["KPI_name"]  || "",
        dept:         r["Department"]    || r["Dept"]       || "",
        type:         r["Type"]          || "",
        target:       r["Target"]        || 0,
        current:      r["Current_Value"] || r["Current"]   || 0,
        progress_pct: r["Progress_%"]    || r["Progress"]  || 0,
        status:       r["Status"]        || "Not Started",
        weight:       r["Weight"]        || 0,
      })).filter(k => k.name);

      setKpis(mapped);
      setLastSync(new Date().toLocaleTimeString("fr-FR"));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // Auto-refresh toutes les 5 minutes
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const depts   = ["All", ...Object.keys(deptColors)];
  const filtered = filter === "All" ? kpis : kpis.filter(k => k.dept === filter);

  const totalWeight = kpis.reduce((s, k) => s + parseFloat(k.weight || 0), 0);
  const totalScore  = totalWeight > 0
    ? kpis.reduce((s, k) => s + Math.min(parseFloat(k.progress_pct || 0), 1) * parseFloat(k.weight || 0), 0) / totalWeight
    : 0;

  const doneCount   = kpis.filter(k => k.status === "Done").length;
  const inProgCount = kpis.filter(k => k.status === "In Progress").length;

  const deptStats = Object.keys(deptColors).map(dept => {
    const dk = kpis.filter(k => k.dept === dept);
    const dw = dk.reduce((s, k) => s + parseFloat(k.weight || 0), 0);
    const score = dw > 0
      ? dk.reduce((s, k) => s + Math.min(parseFloat(k.progress_pct || 0), 1) * parseFloat(k.weight || 0), 0) / dw
      : 0;
    return { dept, score: Math.round(score * 100), count: dk.length, color: deptColors[dept] };
  });

  const week = `S${Math.ceil((new Date() - new Date(new Date().getFullYear(), 0, 1)) / (7 * 86400000))}`;

  return (
    <div style={{ minHeight: "100vh", background: "#060d18", fontFamily: "'DM Mono','Courier New',monospace", color: "#e2e8f0", padding: "32px 24px" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Space+Grotesk:wght@400;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #1e3a5f; border-radius: 4px; }
        button { font-family: inherit; }
      `}</style>

      <div style={{ maxWidth: 1200, margin: "0 auto" }}>

        {/* ── Header ── */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 32, flexWrap: "wrap", gap: 16 }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: "0.25em", color: "#00c2ff", textTransform: "uppercase", marginBottom: 6 }}>
              iExec · Dashboard Stratégique
            </div>
            <h1 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 28, fontWeight: 700, color: "#f8fafc", letterSpacing: "-0.02em" }}>
              KPI Hebdomadaires
            </h1>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            {lastSync && (
              <div style={{ fontSize: 11, color: "#475569" }}>🔄 Sync : {lastSync}</div>
            )}
            <button onClick={fetchData} disabled={loading}
              style={{ padding: "8px 16px", background: "rgba(0,194,255,0.08)", border: "1px solid rgba(0,194,255,0.2)", borderRadius: 10, fontSize: 12, color: "#00c2ff", fontWeight: 500, cursor: "pointer" }}>
              {loading ? "⟳ Chargement..." : "⟳ Actualiser"}
            </button>
            <div style={{ padding: "8px 16px", background: "rgba(0,194,255,0.08)", border: "1px solid rgba(0,194,255,0.2)", borderRadius: 10, fontSize: 12, color: "#00c2ff", fontWeight: 500 }}>
              📅 {week} · 2025
            </div>
          </div>
        </div>

        {/* ── Error ── */}
        {error && (
          <div style={{ background: "rgba(251,113,133,0.1)", border: "1px solid rgba(251,113,133,0.3)", borderRadius: 12, padding: "16px 20px", marginBottom: 24, fontSize: 12, color: "#fb7185" }}>
            <strong>⚠️ Impossible de charger les données :</strong> {error}
            <div style={{ color: "#94a3b8", marginTop: 8 }}>
              → Assurez-vous que le Google Sheet est partagé en <strong>lecture publique</strong> :<br/>
              <em>Fichier → Partager → "Toute personne avec le lien" → Lecteur</em>
            </div>
          </div>
        )}

        {/* ── Loading ── */}
        {loading && !error && (
          <div style={{ textAlign: "center", padding: "80px 0", color: "#475569" }}>
            <div style={{ fontSize: 40, marginBottom: 16, animation: "spin 1s linear infinite" }}>⟳</div>
            <div style={{ fontSize: 13 }}>Connexion à Google Sheets en cours...</div>
            <style>{`@keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }`}</style>
          </div>
        )}

        {/* ── Data loaded ── */}
        {!loading && !error && kpis.length > 0 && (<>

          {/* Score Banner */}
          <div style={{ background: "linear-gradient(135deg,rgba(0,194,255,0.08) 0%,rgba(10,24,46,0.9) 100%)", border: "1px solid rgba(0,194,255,0.2)", borderRadius: 20, padding: "28px 32px", marginBottom: 24, display: "flex", gap: 32, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, letterSpacing: "0.15em", color: "#64748b", textTransform: "uppercase", marginBottom: 8 }}>Score d'exécution stratégique</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 56, fontWeight: 700, color: "#00c2ff", lineHeight: 1 }}>
                  {Math.round(totalScore * 100)}
                </span>
                <span style={{ fontSize: 24, color: "#00c2ff66" }}>/ 100</span>
              </div>
              <div style={{ marginTop: 12, height: 6, background: "rgba(255,255,255,0.05)", borderRadius: 6, overflow: "hidden", maxWidth: 400 }}>
                <div style={{ width: `${Math.round(totalScore * 100)}%`, height: "100%", background: "linear-gradient(90deg,#00c2ff,#38bdf8)", borderRadius: 6, transition: "width 1s ease" }}/>
              </div>
            </div>
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
              {[
                { label: "Complétés",   value: doneCount,                             color: "#34d399" },
                { label: "En cours",    value: inProgCount,                           color: "#f59e0b" },
                { label: "À démarrer", value: kpis.length - doneCount - inProgCount, color: "#64748b" },
                { label: "Total KPIs", value: kpis.length,                           color: "#00c2ff" },
              ].map(s => (
                <div key={s.label} style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 28, fontWeight: 700, color: s.color, fontFamily: "'Space Grotesk',sans-serif" }}>{s.value}</div>
                  <div style={{ fontSize: 11, color: "#475569", marginTop: 2 }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Dept Performance */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 12, marginBottom: 24 }}>
            {deptStats.filter(d => d.count > 0).map(d => (
              <div key={d.dept} onClick={() => setFilter(filter === d.dept ? "All" : d.dept)}
                style={{ background: filter === d.dept ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.03)", border: `1px solid ${filter === d.dept ? d.color + "55" : "rgba(255,255,255,0.06)"}`, borderRadius: 12, padding: "14px 16px", cursor: "pointer", transition: "all 0.2s" }}>
                <div style={{ fontSize: 10, color: d.color, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6 }}>{d.dept}</div>
                <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 22, fontWeight: 700, color: "#f8fafc" }}>{d.score}%</div>
                <div style={{ height: 3, background: "rgba(255,255,255,0.05)", borderRadius: 4, marginTop: 8, overflow: "hidden" }}>
                  <div style={{ width: `${d.score}%`, height: "100%", background: d.color, borderRadius: 4 }}/>
                </div>
                <div style={{ fontSize: 10, color: "#475569", marginTop: 6 }}>{d.count} KPI{d.count > 1 ? "s" : ""}</div>
              </div>
            ))}
          </div>

          {/* Filter tabs */}
          <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
            {depts.map(d => (
              <button key={d} onClick={() => setFilter(d)}
                style={{ padding: "6px 14px", borderRadius: 8, fontSize: 11, fontWeight: 600, border: `1px solid ${filter === d ? "#00c2ff" : "rgba(255,255,255,0.1)"}`, background: filter === d ? "rgba(0,194,255,0.15)" : "transparent", color: filter === d ? "#00c2ff" : "#64748b", cursor: "pointer", transition: "all 0.2s" }}>
                {d}
              </button>
            ))}
          </div>

          {/* KPI Grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 14, marginBottom: 32 }}>
            {filtered.map(kpi => <KpiCard key={kpi.id} kpi={kpi}/>)}
          </div>

        </>)}

        {/* Footer */}
        <div style={{ textAlign: "center", marginTop: 24, fontSize: 10, color: "#1e3a5f", letterSpacing: "0.1em" }}>
          IEXEC · STRATEGIC KPI DASHBOARD · {week} 2025 · DONNÉES LIVE GOOGLE SHEETS · AUTO-REFRESH 5MIN
        </div>
      </div>
    </div>
  );
}