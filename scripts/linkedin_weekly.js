/**
 * Script GitHub Action — Collecte hebdomadaire LinkedIn
 *
 * Secrets GitHub requis :
 *   LINKEDIN_ACCESS_TOKEN
 *   LINKEDIN_ORGANIZATION_ID
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL
 *   GOOGLE_PRIVATE_KEY
 */

const SHEET_ID     = "1Mp8SVYlWw-P6z0ty_JuBEhZtpzqUzMYtBuO9z0knZ4I";
const LINKEDIN_TAB = "LinkedIn_Weekly";
const LI_BASE      = "https://api.linkedin.com/v2";
const ORG_ID       = process.env.LINKEDIN_ORGANIZATION_ID || "10981269";

function getCurrentWeekLabel() {
  const now = new Date();
  const day = now.getUTCDay() === 0 ? 7 : now.getUTCDay();
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (day - 1)));
  const thu = new Date(monday.getTime() + 3 * 86400000);
  const jan1 = new Date(Date.UTC(thu.getUTCFullYear(), 0, 1));
  const wn = Math.ceil(((thu - jan1) / 86400000 + 1) / 7);
  return `${thu.getUTCFullYear()}-W${String(wn).padStart(2, "0")}`;
}

function getCurrentWeekRange() {
  const now = new Date();
  const day = now.getUTCDay() === 0 ? 7 : now.getUTCDay();
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (day - 1)));
  const sunday = new Date(monday.getTime() + 6 * 86400000);
  sunday.setUTCHours(23, 59, 59, 999);
  return { start: monday.getTime(), end: sunday.getTime() };
}

async function liGet(path) {
  const token = process.env.LINKEDIN_ACCESS_TOKEN;
  const res = await fetch(`${LI_BASE}${path}`, {
    headers: {
      "Authorization": `Bearer ${token}`,
      "LinkedIn-Version": "202401",
      "X-Restli-Protocol-Version": "2.0.0",
    },
  });
  if (!res.ok) throw new Error(`LinkedIn ${res.status}: ${await res.text()}`);
  return res.json();
}

async function fetchFollowers() {
  const data = await liGet(`/organizationalEntityFollowerStatistics?q=organizationalEntity&organizationalEntity=urn%3Ali%3Aorganization%3A${ORG_ID}`);
  const s = data.elements?.[0]?.totalFollowerCounts ?? {};
  const total   = (s.organicFollowerCount ?? 0) + (s.paidFollowerCount ?? 0);
  return { total: total || null, organic: s.organicFollowerCount ?? null };
}

async function fetchPageStats() {
  const { start, end } = getCurrentWeekRange();
  const data = await liGet(`/organizationPageStatistics?q=organization&organization=urn%3Ali%3Aorganization%3A${ORG_ID}&timeIntervals.timeGranularityType=WEEK&timeIntervals.timeRange.start=${start}&timeIntervals.timeRange.end=${end}`);
  let views = 0, visitors = 0;
  for (const el of data.elements ?? []) {
    views    += el.totalPageStatistics?.views?.allPageViews?.pageViews ?? 0;
    visitors += el.totalPageStatistics?.views?.allPageViews?.uniquePageViews ?? 0;
  }
  return { views: views || null, visitors: visitors || null };
}

async function fetchShareStats() {
  const { start, end } = getCurrentWeekRange();
  const data = await liGet(`/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=urn%3Ali%3Aorganization%3A${ORG_ID}&timeIntervals.timeGranularityType=WEEK&timeIntervals.timeRange.start=${start}&timeIntervals.timeRange.end=${end}`);
  let impressions = 0, clicks = 0, likes = 0, comments = 0, shares = 0;
  for (const el of data.elements ?? []) {
    const s = el.totalShareStatistics ?? {};
    impressions += s.impressionCount ?? 0;
    clicks      += s.clickCount      ?? 0;
    likes       += s.likeCount       ?? 0;
    comments    += s.commentCount    ?? 0;
    shares      += s.shareCount      ?? 0;
  }
  const engagementRate = impressions > 0 ? ((clicks + likes + comments + shares) / impressions * 100) : null;
  return { impressions: impressions || null, clicks: clicks || null, likes: likes || null, comments: comments || null, shares: shares || null, engagementRate: engagementRate ? parseFloat(engagementRate.toFixed(2)) : null };
}

// ── Google Sheets ─────────────────────────────────────────────────────────────
async function getGoogleToken() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n");
  const now = Math.floor(Date.now() / 1000);
  const claim = { iss: email, scope: "https://www.googleapis.com/auth/spreadsheets", aud: "https://oauth2.googleapis.com/token", exp: now + 3600, iat: now };
  const { createSign } = await import("node:crypto");
  const b64 = obj => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64(claim)}`;
  const sign = createSign("RSA-SHA256");
  sign.update(unsigned);
  const jwt = `${unsigned}.${sign.sign(privateKey, "base64url")}`;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const data = await r.json();
  if (!data.access_token) throw new Error(`Google auth failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

async function weekExists(gToken, week) {
  const range = encodeURIComponent(`${LINKEDIN_TAB}!A:A`);
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}`, { headers: { "Authorization": `Bearer ${gToken}` } });
  const data = await r.json();
  return (data.values || []).some(row => row[0] === week);
}

async function getLastFollowers(gToken) {
  const range = encodeURIComponent(`${LINKEDIN_TAB}!A:B`);
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}`, { headers: { "Authorization": `Bearer ${gToken}` } });
  const data = await r.json();
  const rows = (data.values || []).slice(1).filter(r => r[0]);
  const last = rows.sort((a, b) => String(a[0]).localeCompare(String(b[0]))).at(-1);
  return last ? parseFloat(last[1]) || null : null;
}

async function appendRow(gToken, row) {
  const range = encodeURIComponent(`${LINKEDIN_TAB}!A:K`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Authorization": `Bearer ${gToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values: [row] }),
  });
  return r.json();
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
async function main() {
  if (!process.env.LINKEDIN_ACCESS_TOKEN) { console.error("❌ LINKEDIN_ACCESS_TOKEN manquant"); process.exit(1); }
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL) { console.error("❌ GOOGLE_SERVICE_ACCOUNT_EMAIL manquant"); process.exit(1); }

  const week = getCurrentWeekLabel();
  console.log(`\n📅 Semaine : ${week}\n`);

  const gToken = await getGoogleToken();

  const exists = await weekExists(gToken, week);
  if (exists) { console.log(`ℹ️  ${week} déjà présente — skip`); return; }

  console.log("🔄 Fetching LinkedIn followers...");
  const followers = await fetchFollowers();
  console.log(`  ✅ Followers: ${followers.total}`);

  console.log("🔄 Fetching LinkedIn page stats...");
  const pageStats = await fetchPageStats();
  console.log(`  ✅ Page views: ${pageStats.views}, Visitors: ${pageStats.visitors}`);

  console.log("🔄 Fetching LinkedIn share stats...");
  const shareStats = await fetchShareStats();
  console.log(`  ✅ Impressions: ${shareStats.impressions}, Engagement rate: ${shareStats.engagementRate}%`);

  const prevFollowers = await getLastFollowers(gToken);
  const delta = followers.total != null && prevFollowers != null ? followers.total - prevFollowers : null;
  console.log(`  ✅ Δ Followers: ${delta != null ? (delta >= 0 ? "+" : "") + delta : "n/a"}`);

  const row = [
    week,
    followers.total      ?? null,
    delta                ?? null,
    pageStats.views      ?? null,
    pageStats.visitors   ?? null,
    shareStats.impressions   ?? null,
    shareStats.clicks        ?? null,
    shareStats.likes         ?? null,
    shareStats.comments      ?? null,
    shareStats.shares        ?? null,
    shareStats.engagementRate ?? null,
  ];

  await appendRow(gToken, row);
  console.log(`\n✅ LinkedIn_Weekly écrit pour ${week}`);
}

main().catch(e => { console.error("❌ Fatal:", e.message); process.exit(1); });
