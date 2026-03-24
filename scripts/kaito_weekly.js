/**
 * Script GitHub Action — Récupère les données Kaito et écrit dans Google Sheets
 * Utilise l'API Kaito AI officielle (kaito.ai/api)
 * 
 * Secrets GitHub requis :
 *   KAITO_API_KEY
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL
 *   GOOGLE_PRIVATE_KEY
 */

const SHEET_ID  = "1Mp8SVYlWw-P6z0ty_JuBEhZtpzqUzMYtBuO9z0knZ4I";
const SHEET_TAB = "Weekly_Snapshot";
const KAITO_BASE = "https://api.kaito.ai/api/v1";

const PRIVACY_INFRA_TOKENS = ["ZAMA","AZTEC","ARCIUM","MIDEN","ALEO","RAIL","RLC","ROSE","PHA"];
const TEE_TOKENS = ["RLC","ROSE","PHA","SCRT"];

const KPI_NAMES = {
  "9":  "Maintain 2.61% privacy infra mindshare",
  "10": "#1 TEE ≥50% Period",
};

// ── Calcul de la semaine W-2 (données garanties disponibles dans Kaito) ────────
function getWeekRange() {
  const now = new Date();
  const dow = now.getUTCDay() === 0 ? 7 : now.getUTCDay();
  const mondayThis = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (dow - 1)));
  const mondayPrev = new Date(mondayThis.getTime() - 14 * 86400000); // W-2
  const sundayPrev = new Date(mondayThis.getTime() - 8  * 86400000);
  const fmt = d => d.toISOString().split("T")[0];
  const thursday = new Date(mondayPrev.getTime() + 3 * 86400000);
  const jan1 = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const isoWeek = Math.ceil(((thursday - jan1) / 86400000 + 1) / 7);
  const label = `${thursday.getUTCFullYear()}-W${String(isoWeek).padStart(2, "0")}`;
  return { start: fmt(mondayPrev), end: fmt(sundayPrev), label };
}

// ── Fetch mindshare d'un token via l'API Kaito ────────────────────────────────
async function fetchMindshare(token, start, end, apiKey) {
  try {
    const url = `${KAITO_BASE}/mindshare?token=${token}&start_date=${start}&end_date=${end}`;
    const res = await fetch(url, {
      headers: { "Authorization": `Bearer ${apiKey}`, "Accept": "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (res.status === 403) {
      console.warn(`  ⚠ ${token}: 403 Forbidden — skipping`);
      return 0;
    }
    if (!res.ok) {
      console.warn(`  ⚠ ${token}: HTTP ${res.status}`);
      return 0;
    }
    const data = await res.json();
    const vals = Object.values(data?.mindshare || {});
    return vals.reduce((s, v) => s + (parseFloat(v) || 0), 0);
  } catch (e) {
    console.warn(`  ⚠ ${token}: ${e.message}`);
    return 0;
  }
}

// ── Google Sheets Auth ────────────────────────────────────────────────────────
async function getGoogleToken(email, privateKeyRaw) {
  const privateKey = privateKeyRaw.replace(/\\n/g, "\n");
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600, iat: now,
  };
  const b64 = obj => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64(claim)}`;

  const { createSign } = await import("node:crypto");
  const sign = createSign("RSA-SHA256");
  sign.update(unsigned);
  const signature = sign.sign(privateKey, "base64url");
  const jwt = `${unsigned}.${signature}`;

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const data = await r.json();
  if (!data.access_token) throw new Error(`Google auth failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

// ── Vérifier si la semaine est déjà dans Sheets ───────────────────────────────
async function weekExists(token, week, kpiId) {
  const range = encodeURIComponent(`${SHEET_TAB}!A:C`);
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}`, {
    headers: { "Authorization": `Bearer ${token}` },
  });
  const data = await r.json();
  return (data.values || []).some(row => row[0] === week && row[2] === String(kpiId));
}

// ── Écrire dans Sheets ────────────────────────────────────────────────────────
async function appendRows(token, rows) {
  const range = encodeURIComponent(`${SHEET_TAB}!A:E`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values: rows }),
  });
  return r.json();
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
async function main() {
  const apiKey  = process.env.KAITO_API_KEY;
  const saEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const saKey   = process.env.GOOGLE_PRIVATE_KEY;

  if (!apiKey)  { console.error("❌ KAITO_API_KEY manquant"); process.exit(1); }
  if (!saEmail) { console.error("❌ GOOGLE_SERVICE_ACCOUNT_EMAIL manquant"); process.exit(1); }
  if (!saKey)   { console.error("❌ GOOGLE_PRIVATE_KEY manquant"); process.exit(1); }

  const { start, end, label } = getWeekRange();
  console.log(`\n📅 Semaine cible : ${label} (${start} → ${end})\n`);

  // ── KPI 9 : Mindshare Privacy Infra ─────────────────────────────────────────
  console.log("🔍 Fetching Privacy Infra mindshare...");
  const scores = [];
  for (const token of PRIVACY_INFRA_TOKENS) {
    process.stdout.write(`  ${token}... `);
    const val = await fetchMindshare(token, start, end, apiKey);
    scores.push({ token, value: val });
    console.log(val.toFixed(6));
    await new Promise(r => setTimeout(r, 300)); // rate limit safety
  }

  const total   = scores.reduce((s, t) => s + t.value, 0);
  const rlcRaw  = scores.find(t => t.token === "RLC")?.value || 0;
  const rlcShare = total > 0 ? (rlcRaw / total) * 100 : 0;
  console.log(`\n✅ KPI 9 : RLC = ${rlcShare.toFixed(4)}% (total pool = ${total.toFixed(6)})`);

  // ── KPI 10 : TEE Ranking ─────────────────────────────────────────────────────
  console.log("\n🔍 Fetching TEE ranking...");
  const teeScores = [];
  for (const token of TEE_TOKENS) {
    process.stdout.write(`  ${token}... `);
    const val = await fetchMindshare(token, start, end, apiKey);
    teeScores.push({ token, value: val });
    console.log(val.toFixed(6));
    await new Promise(r => setTimeout(r, 300));
  }

  const ranked = teeScores.sort((a, b) => b.value - a.value);
  const rlcRank = ranked.findIndex(t => t.token === "RLC") + 1;
  console.log(`\n✅ KPI 10 : RLC rank = #${rlcRank}`);
  ranked.forEach((t, i) => console.log(`  #${i+1} ${t.token} = ${t.value.toFixed(6)}`));

  // ── Écriture dans Google Sheets ──────────────────────────────────────────────
  console.log("\n📝 Connexion Google Sheets...");
  const gToken = await getGoogleToken(saEmail, saKey);

  const [kpi9exists, kpi10exists] = await Promise.all([
    weekExists(gToken, label, 9),
    weekExists(gToken, label, 10),
  ]);

  const rows = [];
  if (!kpi9exists)  {
    rows.push([label, KPI_NAMES["9"],  "9",  parseFloat(rlcShare.toFixed(4)), "%"]);
    console.log(`  ✓ KPI 9 à écrire : ${rlcShare.toFixed(4)}%`);
  } else {
    console.log(`  ℹ KPI 9 déjà présent pour ${label}`);
  }
  if (!kpi10exists) {
    rows.push([label, KPI_NAMES["10"], "10", rlcRank, "Rang TEE (1 = premier)"]);
    console.log(`  ✓ KPI 10 à écrire : rank #${rlcRank}`);
  } else {
    console.log(`  ℹ KPI 10 déjà présent pour ${label}`);
  }

  if (rows.length > 0) {
    await appendRows(gToken, rows);
    console.log(`\n✅ ${rows.length} ligne(s) écrite(s) dans Google Sheets`);
  } else {
    console.log("\n✅ Rien à écrire, semaine déjà présente");
  }

  console.log("\n🎉 Done!\n");
}

main().catch(e => { console.error("❌ Fatal:", e.message); process.exit(1); });
