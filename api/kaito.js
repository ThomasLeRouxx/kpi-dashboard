/**
 * Vercel Serverless Function — Proxy Kaito API
 * Fichier à placer dans : /api/kaito.js
 *
 * Variables d'environnement à configurer dans Vercel :
 *   KAITO_API_KEY=your_kaito_api_key_here
 *
 * Endpoints exposés :
 *   GET /api/kaito?type=mindshare   → mindshare Privacy Infra iExec RLC (KPI 9)
 *   GET /api/kaito?type=tee_rank    → mindshare TEE Provider ranking (KPI 10)
 *   GET /api/kaito?type=status      → vérifie si la clé est configurée
 *
 * Données hebdomadaires : on interroge toujours la semaine ISO précédente (W-1)
 */

const KAITO_BASE = "https://api.kaito.ai/api/v1";

// Retourne la semaine ISO précédente sous la forme { year, week, label: "2026-W08" }
function getPrevISOWeek() {
  const now = new Date();
  // Reculer de 7 jours pour avoir la semaine précédente
  const prev = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const jan1 = new Date(prev.getFullYear(), 0, 1);
  const week = Math.ceil(((prev - jan1) / 86400000 + jan1.getDay() + 1) / 7);
  const label = `${prev.getFullYear()}-W${String(week).padStart(2, "0")}`;
  return { year: prev.getFullYear(), week, label };
}

// Retourne la semaine ISO courante
function getCurrentISOWeek() {
  const now = new Date();
  const jan1 = new Date(now.getFullYear(), 0, 1);
  const week = Math.ceil(((now - jan1) / 86400000 + jan1.getDay() + 1) / 7);
  return `${now.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

const KAITO_ENDPOINTS = {
  // Mindshare RLC dans la catégorie "Privacy Infrastructure" — KPI 9
  mindshare: {
    path: "/mindshare",
    buildParams: () => ({
      token: "RLC",
      category: "privacy_infrastructure",
      period: "7d",
      week: getPrevISOWeek().label,
    }),
    extract: (data) => ({
      value: data?.mindshare_pct ?? data?.value ?? null,
      unit: "%",
      label: "Privacy Infra Mindshare",
      week: getPrevISOWeek().label,
    }),
  },
  // Mindshare RLC dans la catégorie "TEE Provider" — KPI 10
  tee_rank: {
    path: "/rankings",
    buildParams: () => ({
      category: "tee_provider",
      token: "RLC",
      period: "7d",
      week: getPrevISOWeek().label,
    }),
    extract: (data) => ({
      value: data?.rank ?? data?.position ?? null,
      unit: "rank",
      label: "TEE Provider Rank",
      week: getPrevISOWeek().label,
    }),
  },
};

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const apiKey = process.env.KAITO_API_KEY;
  const { type } = req.query;

  // Status check
  if (type === "status") {
    return res.status(200).json({
      enabled: !!apiKey,
      currentWeek: getCurrentISOWeek(),
      dataWeek: getPrevISOWeek().label,
      message: apiKey
        ? `Kaito API configurée ✓ — données semaine ${getPrevISOWeek().label}`
        : "KAITO_API_KEY manquante dans les variables Vercel",
    });
  }

  if (!apiKey) {
    return res.status(503).json({ error: "KAITO_API_KEY non configurée", enabled: false });
  }

  const endpoint = KAITO_ENDPOINTS[type];
  if (!endpoint) {
    return res.status(400).json({
      error: `Type inconnu : ${type}. Valeurs acceptées : mindshare, tee_rank`,
    });
  }

  try {
    const params = new URLSearchParams(endpoint.buildParams()).toString();
    const url = `${KAITO_BASE}${endpoint.path}?${params}`;

    const kaitoRes = await fetch(url, {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
    });

    if (!kaitoRes.ok) {
      const errText = await kaitoRes.text();
      return res.status(kaitoRes.status).json({
        error: `Kaito API error ${kaitoRes.status}`,
        detail: errText,
      });
    }

    const rawData = await kaitoRes.json();
    const extracted = endpoint.extract(rawData);

    // Cache 24h côté Vercel Edge (données hebdo, pas besoin de refetch souvent)
    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate");

    return res.status(200).json({
      ...extracted,
      raw: rawData,
      fetchedAt: new Date().toISOString(),
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
