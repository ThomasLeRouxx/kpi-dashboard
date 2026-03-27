/**
 * Script GitHub Action — Appelle l'API REST Kaito directement
 * pour récupérer le mindshare et écrire dans Google Sheets.
 *
 * Secrets GitHub requis :
 *   KAITO_API_KEY
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL
 *   GOOGLE_PRIVATE_KEY
 */

const SHEET_ID      = "1Mp8SVYlWw-P6z0ty_JuBEhZtpzqUzMYtBuO9z0knZ4I";
const HIST_TAB      = "Historique";
const MARKETING_TAB = "Marketing";

const KPI_NAMES = {
  "9":  "Maintain 2.61% privacy infra mindshare",
  "10": "#1 TEE ≥50% Period",
};

const PRIVACY_TOKENS = ["ZAMA","AZTEC","ARCIUM","MIDEN","ALEO","RAIL","RLC","ROSE","PHA","SCRT","INCO"];
const TEE_TOKENS     = ["RLC","ROSE","PHA","SCRT"];

// ── Calcul semaine W-2 ────────────────────────────────────────────────────────
function getWeekRange() {
  const now = new Date();
  const dow = now.getUTCDay() === 0 ? 7 : now.getUTCDay();
  const mondayThis = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (dow - 1)));
  const mondayPrev = new Date(mondayThis.getTime() - 14 * 86400000);
  const sundayPrev = new Date(mondayThis.getTime() -  8 * 86400000);
  const fmt = d => d.toISOString().split("T")[0];
  const thursday = new Date(mondayPrev.getTime() + 3 * 86400000);
  const jan1 = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const isoWeek = Math.ceil(((thursday - jan1) / 86400000 + 1) / 7);
  const label = `${thursday.getUTCFullYear()}-W${String(isoWeek).padStart(2, "0")}`;
  return { start: fmt(mondayPrev), end: fmt(sundayPrev), label };
}

// ── Kaito REST helpers ────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/** Récupère le mindshare d'un token (retourne 0 si 403/404/timeout) */
async function fetchMindshare(token, start, end) {
  const apiKey = process.env.KAITO_API_KEY;
  const url = `https://api.kaito.ai/api/v1/mindshare?token=${encodeURIComponent(token)}&start_date=${start}&end_date=${end}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const r = await fetch(url, {
      headers: { "Authorization": `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (r.status === 403 || r.status === 404) return 0;
    if (!r.ok) { console.error(`  ⚠️  Kaito mindshare ${token}: HTTP ${r.status}`); return 0; }
    const data = await r.json();
    // Gérer les différentes structures de réponse
    if (typeof data.mindshare === "number") return data.mindshare;
    if (data.data && typeof data.data.mindshare === "number") return data.data.mindshare;
    if (Array.isArray(data.data) && data.data.length > 0) return data.data[0].mindshare ?? 0;
    return 0;
  } catch (e) {
    clearTimeout(timeout);
    console.error(`  ⚠️  Kaito mindshare ${token}: ${e.message}`);
    return 0;
  }
}

/** Fetch en batches de `size` tokens, avec `delay` ms entre les batches */
async function fetchInBatches(tokens, fetchFn, size = 3, delay = 300) {
  const results = {};
  for (let i = 0; i < tokens.length; i += size) {
    const batch = tokens.slice(i, i + size);
    const values = await Promise.all(batch.map(t => fetchFn(t)));
    batch.forEach((t, idx) => { results[t] = values[idx]; });
    if (i + size < tokens.length) await sleep(delay);
  }
  return results;
}

/** Smart Followers @iEx_ec */
async function fetchSmartFollowers() {
  const apiKey = process.env.KAITO_API_KEY;
  const url = `https://api.kaito.ai/api/v1/smart_followers?handle=iEx_ec`;
  try {
    const r = await fetch(url, { headers: { "Authorization": `Bearer ${apiKey}` } });
    if (!r.ok) { console.error(`  ⚠️  Smart followers HTTP ${r.status}`); return null; }
    const data = await r.json();
    return data.smart_followers ?? data.count ?? data.total ?? null;
  } catch (e) {
    console.error(`  ⚠️  Smart followers: ${e.message}`);
    return null;
  }
}

/** Mentions RLC sur la période → somme des valeurs du dict */
async function fetchMentions(start, end) {
  const apiKey = process.env.KAITO_API_KEY;
  const url = `https://api.kaito.ai/api/v1/mentions?token=RLC&start_date=${start}&end_date=${end}`;
  try {
    const r = await fetch(url, { headers: { "Authorization": `Bearer ${apiKey}` } });
    if (!r.ok) { console.error(`  ⚠️  Mentions HTTP ${r.status}`); return null; }
    const data = await r.json();
    if (!data || typeof data !== "object" || Object.keys(data).length === 0) return null;
    const total = Object.values(data).reduce((sum, v) => sum + (typeof v === "number" ? v : 0), 0);
    return total || null;
  } catch (e) {
    console.error(`  ⚠️  Mentions: ${e.message}`);
    return null;
  }
}

/** Engagement RLC sur la période → { total, smart } */
async function fetchEngagement(start, end) {
  const apiKey = process.env.KAITO_API_KEY;
  const url = `https://api.kaito.ai/api/v1/engagement?token=RLC&start_date=${start}&end_date=${end}`;
  try {
    const r = await fetch(url, { headers: { "Authorization": `Bearer ${apiKey}` } });
    if (!r.ok) { console.error(`  ⚠️  Engagement HTTP ${r.status}`); return { total: null, smart: null }; }
    const data = await r.json();
    if (!data || typeof data !== "object") return { total: null, smart: null };
    // Soit un dict par date, soit un objet plat
    if (data.total_engagement != null) {
      return { total: data.total_engagement, smart: data.smart_engagement ?? null };
    }
    // Sommer les valeurs journalières
    let total = 0, smart = 0;
    for (const v of Object.values(data)) {
      if (typeof v === "object" && v !== null) {
        total += v.total_engagement ?? v.engagement ?? 0;
        smart += v.smart_engagement ?? 0;
      } else if (typeof v === "number") {
        total += v;
      }
    }
    return { total: total || null, smart: smart || null };
  } catch (e) {
    console.error(`  ⚠️  Engagement: ${e.message}`);
    return { total: null, smart: null };
  }
}

// ── Google Sheets Auth ────────────────────────────────────────────────────────
async function getGoogleToken() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKeyRaw = process.env.GOOGLE_PRIVATE_KEY;
  const privateKey = privateKeyRaw.replace(/\\n/g, "\n");

  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600, iat: now,
  };

  const { createSign } = await import("node:crypto");
  const b64 = obj => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64(claim)}`;
  const sign = createSign("RSA-SHA256");
  sign.update(unsigned);
  const signature = sign.sign(privateKey, "base64url");
  const jwt = `${unsigned}.${signature}`;

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const tokenData = await r.json();
  if (!tokenData.access_token) throw new Error(`Google auth failed: ${JSON.stringify(tokenData)}`);
  return tokenData.access_token;
}

// ── Helpers Google Sheets — onglet Historique ─────────────────────────────────
async function histWeekExists(token, week, kpiId) {
  const range = encodeURIComponent(`${HIST_TAB}!A:C`);
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}`, {
    headers: { "Authorization": `Bearer ${token}` },
  });
  const data = await r.json();
  return (data.values || []).some(row => row[0] === week && row[2] === String(kpiId));
}

async function appendHistRows(token, rows) {
  const range = encodeURIComponent(`${HIST_TAB}!A:E`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values: rows }),
  });
  return r.json();
}

// ── Helpers Google Sheets — onglet Marketing ──────────────────────────────────
async function getLastMarketingRow(token) {
  const range = encodeURIComponent(`${MARKETING_TAB}!A:J`);
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}`, {
    headers: { "Authorization": `Bearer ${token}` },
  });
  const data = await r.json();
  const rows = data.values || [];
  if (rows.length <= 1) return null;
  return rows[rows.length - 1];
}

async function marketingWeekExists(token, week) {
  const range = encodeURIComponent(`${MARKETING_TAB}!A:A`);
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}`, {
    headers: { "Authorization": `Bearer ${token}` },
  });
  const data = await r.json();
  return (data.values || []).some(row => row[0] === week);
}

async function appendMarketingRow(token, row) {
  const range = encodeURIComponent(`${MARKETING_TAB}!A:J`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values: [row] }),
  });
  return r.json();
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
async function main() {
  if (!process.env.KAITO_API_KEY) { console.error("❌ KAITO_API_KEY manquant"); process.exit(1); }
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL) { console.error("❌ GOOGLE_SERVICE_ACCOUNT_EMAIL manquant"); process.exit(1); }
  if (!process.env.GOOGLE_PRIVATE_KEY) { console.error("❌ GOOGLE_PRIVATE_KEY manquant"); process.exit(1); }

  const { start, end, label } = getWeekRange();
  console.log(`\n📅 Semaine cible : ${label} (${start} → ${end})\n`);

  // ── Étape 1 : Mindshare Privacy Infra (KPI 9) ────────────────────────────────
  console.log(`🔄 Fetching Privacy Infra mindshare (${PRIVACY_TOKENS.length} tokens)...`);
  const mindshareMap = await fetchInBatches(
    PRIVACY_TOKENS,
    t => fetchMindshare(t, start, end),
  );
  const rlc_raw   = mindshareMap["RLC"] ?? 0;
  const total_raw = Object.values(mindshareMap).reduce((s, v) => s + v, 0);
  const mindshare_pct = total_raw > 0 ? (rlc_raw / total_raw) * 100 : 0;
  console.log(`  ✅ Mindshare RLC: ${mindshare_pct.toFixed(2)}% (sur total: ${total_raw.toFixed(4)})`);

  // ── Étape 2 : TEE Rank (KPI 10) ──────────────────────────────────────────────
  console.log(`🔄 Fetching TEE rank...`);
  const teeMindshares = {};
  for (const t of TEE_TOKENS) {
    teeMindshares[t] = mindshareMap[t] ?? (await fetchMindshare(t, start, end));
  }
  const teeSorted = [...TEE_TOKENS].sort((a, b) => (teeMindshares[b] ?? 0) - (teeMindshares[a] ?? 0));
  const teeRank = teeSorted.indexOf("RLC") + 1;
  console.log(`  ✅ TEE Rank RLC: #${teeRank} (${teeSorted.map(t => `${t}:${(teeMindshares[t]??0).toFixed(4)}`).join(" | ")})`);

  // ── Étape 3 : Smart Followers @iEx_ec ───────────────────────────────────────
  console.log(`🔄 Fetching Smart Followers @iEx_ec...`);
  const smartFollowers = await fetchSmartFollowers();
  console.log(`  ✅ Smart Followers: ${smartFollowers ?? "null"}`);

  // ── Étape 4 : Engagement RLC ─────────────────────────────────────────────────
  console.log(`🔄 Fetching Engagement RLC...`);
  const [mentions_total, { total: engagement_total, smart: smart_engagement }] = await Promise.all([
    fetchMentions(start, end),
    fetchEngagement(start, end),
  ]);
  console.log(`  ✅ Mentions: ${mentions_total ?? "null"}, Engagement: ${engagement_total ?? "null"} total, ${smart_engagement ?? "null"} smart`);

  // ── Étape 5 : Écriture Google Sheets ─────────────────────────────────────────
  console.log(`\n📝 Écriture Google Sheets...`);
  const gToken = await getGoogleToken();

  // — Onglet Historique (KPI 9 + KPI 10) —
  const [kpi9exists, kpi10exists] = await Promise.all([
    histWeekExists(gToken, label, 9),
    histWeekExists(gToken, label, 10),
  ]);

  const histRows = [];
  if (!kpi9exists)  histRows.push([label, KPI_NAMES["9"],  "9",  mindshare_pct.toFixed(4), "%"]);
  if (!kpi10exists) histRows.push([label, KPI_NAMES["10"], "10", teeRank, "rank"]);

  if (histRows.length > 0) {
    await appendHistRows(gToken, histRows);
    console.log(`  ✅ KPI 9 + KPI 10 écrits dans Historique`);
  } else {
    console.log(`  ℹ️  KPI 9 + KPI 10 déjà présents pour ${label}`);
  }

  // — Onglet Marketing —
  const mktExists = await marketingWeekExists(gToken, label);
  if (mktExists) {
    console.log(`  ℹ️  Marketing déjà présent pour ${label} — aucune écriture`);
  } else {
    const lastRow = await getLastMarketingRow(gToken);
    const prevSF  = lastRow ? Number(lastRow[1]) || 0 : 0;
    const sfChange = prevSF > 0 && smartFollowers != null ? smartFollowers - prevSF : 0;

    // Colonnes A:J : Semaine | SmartFollowers | SF_Change | Mentions_7d | Impressions_7d |
    //                Engagement_7d | SmartEngagement_7d | Mindshare_RLC_Pct | TEE_Rank | Fetched_At
    const mktRow = [
      label,
      smartFollowers   ?? null,
      sfChange,
      mentions_total   ?? null,
      null,                         // Impressions_7d — non disponible via REST
      engagement_total ?? null,
      smart_engagement ?? null,
      mindshare_pct.toFixed(4),
      teeRank,
      new Date().toISOString(),
    ];

    try {
      await appendMarketingRow(gToken, mktRow);
      console.log(`  ✅ Marketing écrit (SF: ${smartFollowers ?? "null"}, ΔSF: ${sfChange > 0 ? "+" : ""}${sfChange})`);
    } catch (e) {
      console.error(`  ❌ Échec écriture Marketing: ${e.message}`);
      throw e;
    }
  }

  console.log(`\n✅ Terminé`);
}

main().catch(e => { console.error("❌ Fatal:", e.message); process.exit(1); });
