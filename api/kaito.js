/**
 * Vercel Serverless Function — Proxy Kaito API + écriture Google Sheets
 * Fichier : /api/kaito.js
 *
 * Variables d'environnement Vercel :
 *   KAITO_API_KEY                 → clé Kaito
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL  → email du service account
 *   GOOGLE_PRIVATE_KEY            → clé privée complète (avec \n)
 *
 * Endpoints :
 *   GET /api/kaito?type=mindshare  → KPI 9 : part RLC dans Privacy Infra (11 tokens)
 *   GET /api/kaito?type=tee_rank   → KPI 10 : rang RLC parmi ROSE/PHA/SCRT
 *   GET /api/kaito?type=all        → fetche les deux + écrit dans Sheets
 *   GET /api/kaito?type=status     → vérifie la configuration
 *   GET /api/kaito?type=marketing  → smart followers, impressions, mentions, rang TEE (onglet Marketing)
 *
 * Timeout étendu à 60s pour supporter les appels Kaito séquentiels
 */
const maxDuration = 60;
exports.maxDuration = maxDuration;

const KAITO_BASE    = "https://api.kaito.ai/api/v1";
const SHEET_ID      = "1Mp8SVYlWw-P6z0ty_JuBEhZtpzqUzMYtBuO9z0knZ4I"; // 'l' et pas '1'
const MARKETING_TAB = "Marketing"; // onglet écrit par kaito_weekly_claude.js

// Référentiel Privacy Infra — KPI 9 (11 tokens : ajout SCRT + INCO)
const PRIVACY_TOKENS = ["ZAMA","AZTEC","ARCIUM","MIDEN","ALEO","RAIL","RLC","ROSE","PHA","SCRT","INCO"];

// Compétiteurs TEE — KPI 10 (SCRT déjà présent)
const TEE_TOKENS = ["RLC","ROSE","PHA","SCRT"];

// Noms des KPIs dans Sheets (colonne "Nom du KPI")
const KPI_NAMES = {
  "9":  "Maintain 2.61% privacy infra mindshare",
  "10": "#1 TEE ≥50% Period",
};

// ─── HELPERS DATE ─────────────────────────────────────────────────────────────
function getPrevWeekRange() {
  const now  = new Date();
  const day  = now.getUTCDay() || 7; // lundi=1 … dimanche=7
  // Kaito indexe avec 2-3 jours de délai — W-2 garantit des données complètes
  const mondayPrev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day - 6));
  const sundayPrev = new Date(mondayPrev);
  sundayPrev.setUTCDate(mondayPrev.getUTCDate() + 6);
  const fmt = d => d.toISOString().slice(0, 10);
  // Numéro ISO via jeudi de la semaine
  const thu = new Date(mondayPrev);
  thu.setUTCDate(mondayPrev.getUTCDate() + 3);
  const yearStart = new Date(Date.UTC(thu.getUTCFullYear(), 0, 1));
  const wn = Math.ceil(((thu - yearStart) / 86400000 + 1) / 7);
  const label = `${thu.getUTCFullYear()}-W${String(wn).padStart(2, "0")}`;
  return { start: fmt(mondayPrev), end: fmt(sundayPrev), label };
}

// ─── KAITO FETCH — avec timeout individuel ────────────────────────────────────
async function fetchWeeklyMindshare(token, start, end, apiKey) {
  try {
    const url = `${KAITO_BASE}/mindshare?token=${encodeURIComponent(token)}&start_date=${start}&end_date=${end}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, {
      headers: { "Authorization": `Bearer ${apiKey}`, "Accept": "application/json" },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    // 403 = token non accessible avec cette clé → on skip (ne pas bloquer le calcul)
    if (!res.ok) {
      console.error(`Kaito ${token}: HTTP ${res.status}`);
      return 0;
    }
    let data;
    try { data = await res.json(); } catch { return 0; }
    // Essayer plusieurs structures de réponse possibles
    if (typeof data.mindshare === "number") return data.mindshare;
    if (data.data && typeof data.data.mindshare === "number") return data.data.mindshare;
    if (Array.isArray(data.data) && data.data.length > 0) return data.data[0].mindshare ?? 0;
    return 0;
  } catch (e) {
    console.error(`Kaito ${token} error:`, e.message);
    return 0;
  }
}

// Fetch en batches parallèles de 3 tokens — compromis vitesse / fiabilité
async function fetchInBatches(tokens, start, end, apiKey) {
  const results = [];
  for (let i = 0; i < tokens.length; i += 3) {
    const batch = tokens.slice(i, i + 3);
    const batchResults = await Promise.all(
      batch.map(t => fetchWeeklyMindshare(t, start, end, apiKey).then(v => ({ token: t, value: v })))
    );
    results.push(...batchResults);
    // Petit délai entre batches pour éviter rate limiting
    if (i + 3 < tokens.length) await new Promise(r => setTimeout(r, 300));
  }
  return results;
}

// ─── KAITO SMART FOLLOWERS ────────────────────────────────────────────────────
async function fetchSmartFollowers(handle, apiKey) {
  try {
    const url = `${KAITO_BASE}/smart_followers?handle=${encodeURIComponent(handle)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, {
      headers: { "Authorization": `Bearer ${apiKey}`, "Accept": "application/json" },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) { console.error(`Kaito smart_followers ${handle}: HTTP ${res.status}`); return null; }
    const data = await res.json();
    // Retourne le nombre de smart followers et l'évolution hebdo si disponible
    return {
      count:   data.smart_followers ?? data.count ?? data.total ?? null,
      weekly_change: data.weekly_change ?? data.change ?? null,
      rank:    data.rank ?? null,
    };
  } catch (e) {
    console.error(`Kaito smart_followers error:`, e.message);
    return null;
  }
}

// ─── KAITO IMPRESSIONS / MENTIONS ─────────────────────────────────────────────
async function fetchMentionsStats(token, start, end, apiKey) {
  try {
    const url = `${KAITO_BASE}/mentions?token=${encodeURIComponent(token)}&start_date=${start}&end_date=${end}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, {
      headers: { "Authorization": `Bearer ${apiKey}`, "Accept": "application/json" },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) { console.error(`Kaito mentions ${token}: HTTP ${res.status}`); return null; }
    const data = await res.json();
    return {
      mentions:    data.mentions ?? data.count ?? null,
      impressions: data.impressions ?? null,
      daily:       Array.isArray(data.data) ? data.data : [],
    };
  } catch (e) {
    console.error(`Kaito mentions error:`, e.message);
    return null;
  }
}

// ─── GOOGLE SHEETS AUTH (JWT manuel, pas de lib externe) ──────────────────────
async function getGoogleAccessToken(email, privateKeyRaw) {
  const privateKey = privateKeyRaw.replace(/\\n/g, "\n");
  const now = Math.floor(Date.now() / 1000);
  const header  = { alg: "RS256", typ: "JWT" };
  const payload = { iss: email, scope: "https://www.googleapis.com/auth/spreadsheets", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 };
  // Encode JWT header + payload
  const enc = v => btoa(JSON.stringify(v)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  const signingInput = `${enc(header)}.${enc(payload)}`;
  // Importe la clé privée PEM
  const pemBody = privateKey.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\n/g, "");
  const keyBuffer = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));
  // Signe avec la clé privée RSA via SubtleCrypto
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8", keyBuffer.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, ["sign"]
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, new TextEncoder().encode(signingInput));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  const jwt = `${signingInput}.${sigB64}`;
  // Échange JWT contre access token
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) throw new Error(`Google auth failed: ${JSON.stringify(tokenData)}`);
  return tokenData.access_token;
}

// ─── VÉRIFIE SI LA LIGNE EXISTE DÉJÀ DANS SHEETS ────────────────────────────
async function weekAlreadyInSheets(accessToken, weekLabel, kpiId) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Historique!A:E`;
  const res  = await fetch(url, { headers: { "Authorization": `Bearer ${accessToken}` } });
  const data = await res.json();
  const rows = data.values || [];
  // Cherche une ligne avec la semaine ET le kpi_id correspondant
  return rows.some(r => r[0] === weekLabel && String(r[2]) === String(kpiId));
}

// ─── ÉCRIT UNE LIGNE DANS SHEETS ─────────────────────────────────────────────
async function appendToSheets(accessToken, rows) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Historique!A:E:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const res   = await fetch(url, {
    method: "POST",
    headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values: rows }),
  });
  return res.json();
}

// ─── HANDLER PRINCIPAL ────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const type   = req.query.type || "status";
  const apiKey = process.env.KAITO_API_KEY;
  const saEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const saKey   = process.env.GOOGLE_PRIVATE_KEY;
  const { start, end, label } = getPrevWeekRange();

  // ── Status ──────────────────────────────────────────────────────────────────
  if (type === "status") {
    return res.status(200).json({
      enabled:       !!apiKey,
      sheetsEnabled: !!(saEmail && saKey),
      dataWeek:      label,
      dateRange:     { start, end },
      message:       apiKey ? `Kaito ✓ — semaine ${label} (${start} → ${end})` : "KAITO_API_KEY manquante",
    });
  }

  if (!apiKey) return res.status(503).json({ error: "KAITO_API_KEY non configurée", enabled: false });

  // ── KPI 9 : Privacy Infra Mindshare (11 tokens : SCRT + INCO ajoutés) ──────
  const computeMindshare = async () => {
    // Fetch par batch de 3 pour éviter timeout (11 tokens total)
    const scores = await fetchInBatches(PRIVACY_TOKENS, start, end, apiKey);
    const total_raw = scores.reduce((s, x) => s + x.value, 0);
    const rlc_raw   = scores.find(x => x.token === "RLC")?.value ?? 0;
    const rlcShare  = total_raw > 0 ? (rlc_raw / total_raw) * 100 : 0;
    return { value: parseFloat(rlcShare.toFixed(4)), unit: "%", label: "Part RLC dans Privacy Infra", week: label,
      detail: { rlc_raw, total_raw, breakdown: scores.map(x => ({ token: x.token, value: x.value })) } };
  };

  // ── KPI 10 : TEE Ranking ─────────────────────────────────────────────────────
  const computeTeeRank = async () => {
    // Seulement 4 tokens — pas de batching nécessaire
    const scores  = await Promise.all(
      TEE_TOKENS.map(t => fetchWeeklyMindshare(t, start, end, apiKey).then(v => ({ token: t, value: v })))
    );
    const sorted  = [...scores].sort((a, b) => b.value - a.value);
    const rlcRank = sorted.findIndex(x => x.token === "RLC") + 1;
    return { value: rlcRank, unit: "rank", label: "TEE Rank RLC", week: label,
      detail: { ranking: sorted.map((x, i) => ({ rank: i + 1, token: x.token, mindshare: x.value })) } };
  };

  if (type === "mindshare") {
    try {
      const result = await computeMindshare();
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json({ ...result, fetchedAt: new Date().toISOString() });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  if (type === "tee_rank") {
    try {
      const result = await computeTeeRank();
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json({ ...result, fetchedAt: new Date().toISOString() });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── MARKETING : smart followers + impressions + mentions + TEE rank ──────────
  if (type === "marketing") {
    try {
      res.setHeader("Cache-Control", "no-store");

      // Lancer les fetches en parallèle (avec fallback si certains endpoints n'existent pas)
      const [smartFollowers, mentionsRLC, mindshareData, teeRankData] = await Promise.allSettled([
        fetchSmartFollowers("iEx_ec", apiKey),
        fetchMentionsStats("RLC", start, end, apiKey),
        computeMindshare(),
        computeTeeRank(),
      ]);

      const sf  = smartFollowers.status  === "fulfilled" ? smartFollowers.value  : null;
      const men = mentionsRLC.status     === "fulfilled" ? mentionsRLC.value     : null;
      const ms  = mindshareData.status   === "fulfilled" ? mindshareData.value   : null;
      const tee = teeRankData.status     === "fulfilled" ? teeRankData.value     : null;

      return res.status(200).json({
        week:   label,
        dateRange: { start, end },
        smartFollowers: {
          count:        sf?.count        ?? null,
          weekly_change: sf?.weekly_change ?? null,
          rank:         sf?.rank         ?? null,
          handle:       "iEx_ec",
        },
        mentions: {
          total:       men?.mentions    ?? null,
          impressions: men?.impressions ?? null,
          daily:       men?.daily       ?? [],
        },
        mindshare: ms ? {
          value:     ms.value,
          unit:      ms.unit,
          breakdown: ms.detail?.breakdown ?? [],
          rlc_raw:   ms.detail?.rlc_raw   ?? 0,
          total_raw: ms.detail?.total_raw  ?? 0,
        } : null,
        teeRank: tee ? {
          rank:    tee.value,
          ranking: tee.detail?.ranking ?? [],
        } : null,
        fetchedAt: new Date().toISOString(),
      });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── MARKETING SHEET : lit l'onglet Marketing du Google Sheet ────────────────
  if (type === "marketing_sheet") {
    if (!saEmail || !saKey) {
      return res.status(503).json({ error: "Credentials Google non configurés", enabled: false });
    }
    try {
      res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate");
      const accessToken = await getGoogleAccessToken(saEmail, saKey);

      // Lecture de l'onglet Marketing (colonnes A:J)
      const range = encodeURIComponent(`${MARKETING_TAB}!A:J`);
      const sheetRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}`,
        { headers: { "Authorization": `Bearer ${accessToken}` } }
      );
      const sheetData = await sheetRes.json();
      const rows = (sheetData.values || []).slice(1); // ignorer la ligne header

      if (rows.length === 0) {
        return res.status(200).json({ week: null, smartFollowers: null, mentions: null, engagement: null, mindshareRLC: null, teeRank: null, history: [] });
      }

      // Parser une ligne de l'onglet Marketing
      // Colonnes : Semaine(0) | SF(1) | SF_Change(2) | Mentions(3) | Impressions(4) | Engagement(5) | SmartEngagement(6) | Mindshare(7) | TEERank(8) | Fetched_At(9)
      const parseRow = r => ({
        week:         r[0] ?? null,
        smartFollowers: Number(r[1]) || 0,
        sfChange:       Number(r[2]) || 0,
        mentions:       Number(r[3]) || 0,
        impressions:    Number(r[4]) || 0,
        engagement:     Number(r[5]) || 0,
        smartEngagement: Number(r[6]) || 0,
        mindshare:      parseFloat(r[7]) || 0,
        teeRank:        Number(r[8]) || null,
        fetchedAt:      r[9] ?? null,
      });

      // 12 dernières semaines pour les sparklines
      const history = rows.slice(-12).map(parseRow);
      const last    = history[history.length - 1];
      const prev    = history.length >= 2 ? history[history.length - 2] : null;

      // Variation mentions en % vs semaine précédente
      const mentionsPct = prev && prev.mentions > 0
        ? parseFloat(((last.mentions - prev.mentions) / prev.mentions * 100).toFixed(1))
        : null;

      return res.status(200).json({
        week: last.week,
        smartFollowers: { count: last.smartFollowers, weekly_change: last.sfChange },
        mentions:   { total: last.mentions, impressions: last.impressions, weekly_change_pct: mentionsPct },
        engagement: { total: last.engagement, smart: last.smartEngagement },
        mindshareRLC: { value: last.mindshare, unit: "%" },
        teeRank: last.teeRank,
        history: history.map(r => ({
          week: r.week,
          smartFollowers: r.smartFollowers,
          mentions:       r.mentions,
          engagement:     r.engagement,
          mindshare:      r.mindshare,
        })),
        fetchedAt: new Date().toISOString(),
      });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── ALL : fetche les deux + écrit dans Sheets si pas déjà présent ────────────
  if (type === "all") {
    try {
      const [mindshare, teeRank] = await Promise.all([computeMindshare(), computeTeeRank()]);
      let sheetsResult = { skipped: true, reason: "Google Sheets non configuré" };
      if (saEmail && saKey) {
        const accessToken = await getGoogleAccessToken(saEmail, saKey);
        const rowsToWrite = [];
        // Vérifie si les lignes existent déjà pour éviter les doublons
        const [kpi9exists, kpi10exists] = await Promise.all([
          weekAlreadyInSheets(accessToken, label, 9),
          weekAlreadyInSheets(accessToken, label, 10),
        ]);
        if (!kpi9exists)  rowsToWrite.push([label, KPI_NAMES["9"],  "9",  mindshare.value, "%"]);
        if (!kpi10exists) rowsToWrite.push([label, KPI_NAMES["10"], "10", teeRank.value,   "rank"]);
        if (rowsToWrite.length > 0) {
          sheetsResult = await appendToSheets(accessToken, rowsToWrite);
          sheetsResult = { written: rowsToWrite.length, rows: rowsToWrite };
        } else {
          sheetsResult = { skipped: true, reason: `Semaine ${label} déjà présente dans Sheets` };
        }
      }
      return res.status(200).json({
        mindshare, teeRank, sheets: sheetsResult, fetchedAt: new Date().toISOString(),
      });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  return res.status(400).json({ error: `Type inconnu : ${type}. Valeurs : mindshare, tee_rank, all, status, marketing, marketing_sheet` });
};
