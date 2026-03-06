/**
 * Vercel Serverless Function — Proxy Kaito API
 * Fichier : /api/kaito.js
 *
 * Variable d'environnement Vercel : KAITO_API_KEY
 *
 * Endpoints :
 *   GET /api/kaito?type=mindshare   → KPI 9 : part de RLC dans le référentiel Privacy Infra
 *   GET /api/kaito?type=tee_rank    → KPI 10 : rang de RLC parmi ROSE, PHA, SCRT
 *   GET /api/kaito?type=status      → vérifie si la clé est configurée
 *
 * Logique : données agrégées sur la semaine ISO précédente (W-1)
 */

const KAITO_BASE = "https://api.kaito.ai/api/v1";

// Référentiel Privacy Infra — KPI 9
const PRIVACY_INFRA_TOKENS = ["ZAMA", "AZTEC", "ARCIUM", "MIDEN", "ALEO", "RAIL", "RLC", "ROSE", "PHA", "INCO"];

// Compétiteurs TEE — KPI 10
const TEE_TOKENS = ["RLC", "ROSE", "PHA", "SCRT"];

// Retourne { start: "YYYY-MM-DD", end: "YYYY-MM-DD", label: "2026-W08" } pour la semaine ISO précédente
function getPrevWeekRange() {
  const now = new Date();
  // Trouver le lundi de la semaine courante
  const dayOfWeek = now.getUTCDay() || 7; // 1=lun ... 7=dim
  const mondayThisWeek = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - dayOfWeek + 1));
  // Semaine précédente : lundi-dimanche
  const mondayPrev = new Date(mondayThisWeek.getTime() - 7 * 86400000);
  const sundayPrev = new Date(mondayThisWeek.getTime() - 86400000);

  const fmt = (d) => d.toISOString().split("T")[0];

  // Calcul du numéro de semaine ISO
  const jan1 = new Date(Date.UTC(mondayPrev.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((mondayPrev - jan1) / 86400000 + jan1.getUTCDay() + 1) / 7);
  const label = `${mondayPrev.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;

  return { start: fmt(mondayPrev), end: fmt(sundayPrev), label };
}

// Fetch le mindshare d'un token sur une période, retourne la somme des valeurs journalières
async function fetchWeeklyMindshare(token, start, end, apiKey) {
  const url = `${KAITO_BASE}/mindshare?token=${token}&start_date=${start}&end_date=${end}`;
  const res = await fetch(url, {
    headers: { "Authorization": `Bearer ${apiKey}`, "Accept": "application/json" },
  });
  if (!res.ok) return 0;
  const data = await res.json();
  const values = Object.values(data?.mindshare || {});
  return values.reduce((sum, v) => sum + (parseFloat(v) || 0), 0);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const apiKey = process.env.KAITO_API_KEY;
  const { type } = req.query;

  // ── Status ──────────────────────────────────────────────────────────────────
  if (type === "status") {
    const { label } = getPrevWeekRange();
    return res.status(200).json({
      enabled: !!apiKey,
      dataWeek: label,
      message: apiKey
        ? `Kaito API configurée ✓ — données semaine ${label}`
        : "KAITO_API_KEY manquante dans les variables Vercel",
    });
  }

  if (!apiKey) return res.status(503).json({ error: "KAITO_API_KEY non configurée", enabled: false });

  const { start, end, label } = getPrevWeekRange();

  // ── KPI 9 : Privacy Infra Mindshare — part de RLC dans le référentiel ───────
  if (type === "mindshare") {
    try {
      // Fetch tous les tokens du référentiel en parallèle
      const scores = await Promise.all(
        PRIVACY_INFRA_TOKENS.map(t => fetchWeeklyMindshare(t, start, end, apiKey).then(v => ({ token: t, value: v })))
      );

      const totalMindshare = scores.reduce((s, t) => s + t.value, 0);
      const rlcMindshare   = scores.find(t => t.token === "RLC")?.value || 0;
      const rlcShare       = totalMindshare > 0 ? (rlcMindshare / totalMindshare) * 100 : 0;

      // Cache 24h
      res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate");

      return res.status(200).json({
        value: parseFloat(rlcShare.toFixed(4)),
        unit: "%",
        label: `Part RLC dans Privacy Infra`,
        week: label,
        detail: {
          rlc_raw: rlcMindshare,
          total_raw: totalMindshare,
          breakdown: scores.sort((a, b) => b.value - a.value),
        },
        fetchedAt: new Date().toISOString(),
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── KPI 10 : TEE Ranking — rang de RLC parmi ROSE, PHA, SCRT ────────────────
  if (type === "tee_rank") {
    try {
      const scores = await Promise.all(
        TEE_TOKENS.map(t => fetchWeeklyMindshare(t, start, end, apiKey).then(v => ({ token: t, value: v })))
      );

      // Trier par mindshare décroissant
      const ranked = scores.sort((a, b) => b.value - a.value);
      const rlcRank = ranked.findIndex(t => t.token === "RLC") + 1;

      res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate");

      return res.status(200).json({
        value: rlcRank,
        unit: "rank",
        label: `TEE Rank RLC vs ROSE/PHA/SCRT`,
        week: label,
        detail: {
          ranking: ranked.map((t, i) => ({ rank: i + 1, token: t.token, mindshare: t.value })),
        },
        fetchedAt: new Date().toISOString(),
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(400).json({ error: `Type inconnu : ${type}. Valeurs : mindshare, tee_rank, status` });
}
