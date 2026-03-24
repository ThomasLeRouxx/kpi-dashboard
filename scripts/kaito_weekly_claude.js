/**
 * Script GitHub Action — Utilise Claude API + MCP Kaito pour récupérer
 * le mindshare et écrire dans Google Sheets
 *
 * Secrets GitHub requis :
 *   ANTHROPIC_API_KEY
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL
 *   GOOGLE_PRIVATE_KEY
 */

const SHEET_ID  = "1Mp8SVYlWw-P6z0ty_JuBEhZtpzqUzMYtBuO9z0knZ4I";
const SHEET_TAB = "Weekly_Snapshot";

const KPI_NAMES = {
  "9":  "Maintain 2.61% privacy infra mindshare",
  "10": "#1 TEE ≥50% Period",
};

const PRIVACY_INFRA_TOKENS = ["ZAMA","AZTEC","ARCIUM","MIDEN","ALEO","RAIL","RLC","ROSE","PHA"];
const TEE_TOKENS = ["RLC","ROSE","PHA","SCRT"];

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

// ── Appel Claude API avec MCP Kaito ──────────────────────────────────────────
async function fetchKaitoDataViaClaude(start, end, label) {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  const prompt = `Tu dois récupérer les données de mindshare Kaito pour la semaine ${label} (du ${start} au ${end}).

Effectue les appels suivants avec l'outil kaito_mindshare pour chaque token listé :
- Privacy Infra tokens : ${PRIVACY_INFRA_TOKENS.join(", ")}
- TEE tokens supplémentaires : SCRT

Pour chaque token, somme toutes les valeurs journalières (start_date: ${start}, end_date: ${end}).

Ensuite calcule :
1. KPI 9 — Part RLC dans Privacy Infra : (somme_RLC / somme_tous_tokens_privacy_infra) * 100
2. KPI 10 — Rang RLC parmi les tokens TEE (RLC, ROSE, PHA, SCRT) : 1 si RLC a la plus haute somme, 2 si deuxième, etc.

Réponds UNIQUEMENT avec un JSON valide, sans markdown, sans explication :
{
  "kpi9_value": <nombre avec 4 décimales>,
  "kpi10_rank": <entier 1-4>,
  "breakdown": {
    "RLC": <somme>,
    "ZAMA": <somme>,
    "AZTEC": <somme>,
    "ARCIUM": <somme>,
    "MIDEN": <somme>,
    "ALEO": <somme>,
    "RAIL": <somme>,
    "ROSE": <somme>,
    "PHA": <somme>,
    "SCRT": <somme>
  }
}`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "mcp-client-2025-04-04",
    },
    body: JSON.stringify({
      model: "claude-opus-4-5",
      max_tokens: 4096,
      mcp_servers: [
        {
          type: "url",
          url: "https://mcp.kaito.ai/mcp",
          name: "kaito",
        }
      ],
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${err.slice(0, 300)}`);
  }

  const data = await response.json();

  // Extraire le texte de la réponse
  const textBlock = data.content.find(b => b.type === "text");
  if (!textBlock) throw new Error("Pas de bloc texte dans la réponse Claude");

  console.log("Réponse Claude brute:", textBlock.text.slice(0, 500));

  // Parser le JSON
  const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Pas de JSON trouvé dans la réponse");

  return JSON.parse(jsonMatch[0]);
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

async function weekExists(token, week, kpiId) {
  const range = encodeURIComponent(`${SHEET_TAB}!A:C`);
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}`, {
    headers: { "Authorization": `Bearer ${token}` },
  });
  const data = await r.json();
  return (data.values || []).some(row => row[0] === week && row[2] === String(kpiId));
}

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

async function updateRow(token, rowIndex, value) {
  const range = encodeURIComponent(`${SHEET_TAB}!D${rowIndex}`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}?valueInputOption=USER_ENTERED`;
  const r = await fetch(url, {
    method: "PUT",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values: [[value]] }),
  });
  return r.json();
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
async function main() {
  if (!process.env.ANTHROPIC_API_KEY) { console.error("❌ ANTHROPIC_API_KEY manquant"); process.exit(1); }
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL) { console.error("❌ GOOGLE_SERVICE_ACCOUNT_EMAIL manquant"); process.exit(1); }
  if (!process.env.GOOGLE_PRIVATE_KEY) { console.error("❌ GOOGLE_PRIVATE_KEY manquant"); process.exit(1); }

  const { start, end, label } = getWeekRange();
  console.log(`\n📅 Semaine cible : ${label} (${start} → ${end})\n`);

  // Étape 1 : Récupérer données via Claude + MCP Kaito
  console.log("🤖 Appel Claude API avec MCP Kaito...");
  const kaitoData = await fetchKaitoDataViaClaude(start, end, label);
  console.log(`\n✅ KPI 9  : ${kaitoData.kpi9_value}%`);
  console.log(`✅ KPI 10 : Rank #${kaitoData.kpi10_rank}`);
  console.log("📊 Breakdown:", JSON.stringify(kaitoData.breakdown, null, 2));

  // Étape 2 : Écrire dans Google Sheets
  console.log("\n📝 Connexion Google Sheets...");
  const gToken = await getGoogleToken();

  const [kpi9exists, kpi10exists] = await Promise.all([
    weekExists(gToken, label, 9),
    weekExists(gToken, label, 10),
  ]);

  const rows = [];
  if (!kpi9exists) {
    rows.push([label, KPI_NAMES["9"], "9", kaitoData.kpi9_value, "%"]);
    console.log(`  ✓ KPI 9 à écrire : ${kaitoData.kpi9_value}%`);
  } else {
    console.log(`  ℹ KPI 9 déjà présent pour ${label} — mise à jour si nécessaire`);
  }

  if (!kpi10exists) {
    rows.push([label, KPI_NAMES["10"], "10", kaitoData.kpi10_rank, "Rang TEE (1 = premier)"]);
    console.log(`  ✓ KPI 10 à écrire : rank #${kaitoData.kpi10_rank}`);
  } else {
    console.log(`  ℹ KPI 10 déjà présent pour ${label}`);
  }

  if (rows.length > 0) {
    await appendRows(gToken, rows);
    console.log(`\n✅ ${rows.length} ligne(s) écrite(s) dans Google Sheets`);
  } else {
    console.log("\n✅ Semaine déjà présente dans Sheets");
  }

  console.log("\n🎉 Done!\n");
}

main().catch(e => { console.error("❌ Fatal:", e.message); process.exit(1); });
