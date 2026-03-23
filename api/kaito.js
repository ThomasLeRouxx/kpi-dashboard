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
 *   GET /api/kaito?type=mindshare  → KPI 9 : part RLC dans Privacy Infra
 *   GET /api/kaito?type=tee_rank   → KPI 10 : rang RLC parmi ROSE/PHA/SCRT
 *   GET /api/kaito?type=all        → fetche les deux + écrit dans Sheets
 *   GET /api/kaito?type=status     → vérifie la configuration
 *
 * Timeout étendu à 60s pour supporter les 10 appels Kaito séquentiels
 */
const maxDuration = 60;
exports.maxDuration = maxDuration;

const KAITO_BASE  = "https://api.kaito.ai/api/v1";
const SHEET_ID    = "1Mp8SVYlWw-P6z0ty_JuBEhZtpzqUzMYtBuO9z0knZ4I";
const SHEET_TAB   = "Weekly_Snapshot";

// Référentiel Privacy Infra — KPI 9
const PRIVACY_INFRA_TOKENS = ["ZAMA","AZTEC","ARCIUM","MIDEN","ALEO","RAIL","RLC","ROSE","PHA"];
// Compétiteurs TEE — KPI 10
const TEE_TOKENS = ["RLC","ROSE","PHA","SCRT"];
// Noms des KPIs dans Sheets (colonne "Nom du KPI")
const KPI_NAMES = {
  "9":  "Maintain 2.61% privacy infra mindshare",
  "10": "#1 TEE ≥50% Period",
};

// ─── HELPERS DATE ─────────────────────────────────────────────────────────────
function getPrevWeekRange() {
  const now    = new Date();
  const dow    = now.getUTCDay() === 0 ? 7 : now.getUTCDay(); // 1=lun…7=dim
  const mondayThis = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (dow - 1)));
  // Kaito indexe avec 2-3 jours de délai — W-2 garantit des données complètes
  const mondayPrev = new Date(mondayThis.getTime() - 14 * 86400000);
  const sundayPrev = new Date(mondayThis.getTime() - 8 * 86400000);
  const fmt = d => d.toISOString().split("T")[0];
  // Numéro ISO via jeudi de la semaine
  const thursday = new Date(mondayPrev.getTime() + 3 * 86400000);
  const jan1     = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const isoWeek  = Math.ceil(((thursday - jan1) / 86400000 + 1) / 7);
  const label    = `${thursday.getUTCFullYear()}-W${String(isoWeek).padStart(2,"0")}`;
  return { start: fmt(mondayPrev), end: fmt(sundayPrev), label };
}

// ─── KAITO FETCH — avec timeout individuel ────────────────────────────────────
async function fetchWeeklyMindshare(token, start, end, apiKey) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const url = `${KAITO_BASE}/mindshare?token=${token}&start_date=${start}&end_date=${end}`;
    const res = await fetch(url, {
      headers: { "Authorization": `Bearer ${apiKey}`, "Accept": "application/json" },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    // 403 = token non accessible avec cette clé → on skip (ne pas bloquer le calcul)
    if (res.status === 403) return 0;
    if (!res.ok) {
      console.error(`Kaito ${token}: HTTP ${res.status}`);
      return 0;
    }
    const rawText = await res.text();
    if (token === "RLC") console.log(`Kaito RLC response:`, rawText.slice(0, 500));
    let data;
    try { data = JSON.parse(rawText); } catch(e) { console.error(`Kaito ${token} parse error`); return 0; }
    // Essayer plusieurs structures de réponse possibles
    const mindshareObj = data?.mindshare || data?.data?.mindshare || data?.result?.mindshare || data;
    const vals = Object.values(mindshareObj || {});
    const numVals = vals.filter(v => typeof v === "number" || (typeof v === "string" && !isNaN(parseFloat(v))));
    return numVals.reduce((s, v) => s + parseFloat(v), 0);
  } catch (e) {
    console.error(`Kaito ${token} error:`, e.message);
    return 0;
  }
}

// Fetch en 3 batches parallèles de ~3 tokens — compromis vitesse / fiabilité
async function fetchInBatches(tokens, start, end, apiKey) {
  const size = 3;
  const results = [];
  for (let i = 0; i < tokens.length; i += size) {
    const batch = tokens.slice(i, i + size);
    const batchResults = await Promise.all(
      batch.map(t => fetchWeeklyMindshare(t, start, end, apiKey).then(v => ({ token: t, value: v })))
    );
    results.push(...batchResults);
    // Petit délai entre batches pour éviter rate limiting
    if (i + size < tokens.length) await new Promise(r => setTimeout(r, 300));
  }
  return results;
}

// ─── GOOGLE SHEETS AUTH (JWT manuel, pas de lib externe) ──────────────────────
async function getGoogleAccessToken(email, privateKeyRaw) {
  const privateKey = privateKeyRaw.replace(/\\n/g, "\n");
  const now   = Math.floor(Date.now() / 1000);
  const claim = { iss: email, scope: "https://www.googleapis.com/auth/spreadsheets", aud: "https://oauth2.googleapis.com/token", exp: now + 3600, iat: now };

  // Encode JWT header + payload
  const b64 = obj => btoa(JSON.stringify(obj)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");
  const header  = b64({ alg: "RS256", typ: "JWT" });
  const payload = b64(claim);
  const unsigned = `${header}.${payload}`;

  // Signe avec la clé privée RSA via SubtleCrypto
  const pemBody   = privateKey.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\n/g, "");
  const keyBuffer = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8", keyBuffer.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, ["sign"]
  );
  const sigBuffer  = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, new TextEncoder().encode(unsigned));
  const signature  = btoa(String.fromCharCode(...new Uint8Array(sigBuffer))).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");
  const jwt        = `${unsigned}.${signature}`;

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
  const range  = encodeURIComponent(`${SHEET_TAB}!A:C`);
  const url    = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}`;
  const res    = await fetch(url, { headers: { "Authorization": `Bearer ${accessToken}` } });
  const data   = await res.json();
  const rows   = data.values || [];
  // Cherche une ligne avec la semaine ET le kpi_id correspondant
  return rows.some(row => row[0] === weekLabel && row[2] === String(kpiId));
}

// ─── ÉCRIT UNE LIGNE DANS SHEETS ─────────────────────────────────────────────
async function appendToSheets(accessToken, rows) {
  const range = encodeURIComponent(`${SHEET_TAB}!A:E`);
  const url   = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
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

  const apiKey   = process.env.KAITO_API_KEY;
  const saEmail  = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const saKey    = process.env.GOOGLE_PRIVATE_KEY;
  const { type } = req.query;

  // ── Status ──────────────────────────────────────────────────────────────────
  if (type === "status") {
    const { start, end, label } = getPrevWeekRange();
    return res.status(200).json({
      enabled:       !!apiKey,
      sheetsEnabled: !!(saEmail && saKey),
      dataWeek:      label,
      dateRange:     { start, end },
      message:       apiKey ? `Kaito ✓ — semaine ${label} (${start} → ${end})` : "KAITO_API_KEY manquante",
    });
  }

  if (!apiKey) return res.status(503).json({ error: "KAITO_API_KEY non configurée", enabled: false });

  const { start, end, label } = getPrevWeekRange();

  // ── KPI 9 : Privacy Infra Mindshare ─────────────────────────────────────────
  const computeMindshare = async () => {
    // Fetch par batch de 3 pour éviter timeout (10 tokens total)
    const scores = await fetchInBatches(PRIVACY_INFRA_TOKENS, start, end, apiKey, 3);
    const total    = scores.reduce((s, t) => s + t.value, 0);
    const rlcRaw   = scores.find(t => t.token === "RLC")?.value || 0;
    const rlcShare = total > 0 ? (rlcRaw / total) * 100 : 0;
    return { value: parseFloat(rlcShare.toFixed(4)), unit: "%", label: "Part RLC dans Privacy Infra", week: label,
      detail: { rlc_raw: rlcRaw, total_raw: total, breakdown: scores.sort((a,b) => b.value - a.value) } };
  };

  // ── KPI 10 : TEE Ranking ─────────────────────────────────────────────────────
  const computeTeeRank = async () => {
    // Seulement 4 tokens — pas de batching nécessaire
    const scores  = await Promise.all(
      TEE_TOKENS.map(t => fetchWeeklyMindshare(t, start, end, apiKey).then(v => ({ token: t, value: v })))
    );
    const ranked  = scores.sort((a,b) => b.value - a.value);
    const rlcRank = ranked.findIndex(t => t.token === "RLC") + 1;
    return { value: rlcRank, unit: "rank", label: "TEE Rank RLC", week: label,
      detail: { ranking: ranked.map((t,i) => ({ rank: i+1, token: t.token, mindshare: t.value })) } };
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

  // ── ALL : fetche les deux + écrit dans Sheets si pas déjà présent ────────────
  if (type === "all") {
    try {
      const [mindshare, teeRank] = await Promise.all([computeMindshare(), computeTeeRank()]);
      let sheetsResult = { written: false, reason: "Google credentials manquantes" };

      if (saEmail && saKey) {
        const accessToken = await getGoogleAccessToken(saEmail, saKey);

        // Vérifie si les lignes existent déjà pour éviter les doublons
        const [kpi9exists, kpi10exists] = await Promise.all([
          weekAlreadyInSheets(accessToken, label, 9),
          weekAlreadyInSheets(accessToken, label, 10),
        ]);

        const rowsToWrite = [];
        if (!kpi9exists)  rowsToWrite.push([label, KPI_NAMES["9"],  "9",  mindshare.value, "%"]);
        if (!kpi10exists) rowsToWrite.push([label, KPI_NAMES["10"], "10", teeRank.value,   "Rang TEE (1 = premier)"]);

        if (rowsToWrite.length > 0) {
          await appendToSheets(accessToken, rowsToWrite);
          sheetsResult = { written: true, rows: rowsToWrite.length, week: label };
        } else {
          sheetsResult = { written: false, reason: `Semaine ${label} déjà présente dans Sheets` };
        }
      }

      return res.status(200).json({
        mindshare, teeRank, sheets: sheetsResult, fetchedAt: new Date().toISOString(),
      });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── DEBUG : retourne la réponse brute de l'API Kaito pour RLC ──────────────
  if (type === "debug") {
    try {
      const { start, end, label } = getPrevWeekRange();
      const url = `${KAITO_BASE}/mindshare?token=RLC&start_date=${start}&end_date=${end}`;
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 10000);
      const r = await fetch(url, {
        headers: { "Authorization": `Bearer ${apiKey}`, "Accept": "application/json" },
        signal: controller.signal,
      });
      const rawText = await r.text();
      return res.status(200).json({
        url, week: label, start, end,
        httpStatus: r.status,
        rawResponse: rawText.slice(0, 1000),
      });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(400).json({ error: `Type inconnu : ${type}. Valeurs : mindshare, tee_rank, all, status` });
}
