/**
 * /api/linkedin
 *
 * Endpoints :
 *   GET /api/linkedin?type=sheet   → lit LinkedIn_Weekly depuis Google Sheets (cached 1h)
 *   GET /api/linkedin?type=fetch   → fetche les données LinkedIn live + écrit dans Sheets
 *   GET /api/linkedin?type=status  → vérifie la configuration
 *
 * Variables d'environnement requises :
 *   LINKEDIN_ACCESS_TOKEN          → token OAuth LinkedIn
 *   LINKEDIN_ORGANIZATION_ID       → ex: 10981269
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL
 *   GOOGLE_PRIVATE_KEY
 */

const maxDuration = 30;
exports.maxDuration = maxDuration;

const SHEET_ID      = "1Mp8SVYlWw-P6z0ty_JuBEhZtpzqUzMYtBuO9z0knZ4I";
const LINKEDIN_TAB  = "LinkedIn_Weekly";
const LI_BASE       = "https://api.linkedin.com/v2";

// ─── HELPERS DATE ─────────────────────────────────────────────────────────────
function getCurrentWeekLabel() {
  const now = new Date();
  const day = now.getUTCDay() || 7;
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (day - 1)));
  const thu = new Date(monday);
  thu.setUTCDate(monday.getUTCDate() + 3);
  const yearStart = new Date(Date.UTC(thu.getUTCFullYear(), 0, 1));
  const wn = Math.ceil(((thu - yearStart) / 86400000 + 1) / 7);
  return `${thu.getUTCFullYear()}-W${String(wn).padStart(2, "0")}`;
}

// Timestamps LinkedIn (ms) pour la semaine courante
function getCurrentWeekRange() {
  const now = new Date();
  const day = now.getUTCDay() || 7;
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (day - 1)));
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  sunday.setUTCHours(23, 59, 59, 999);
  return { start: monday.getTime(), end: sunday.getTime() };
}

// ─── LINKEDIN API FETCH ────────────────────────────────────────────────────────
async function liGet(path, token) {
  const res = await fetch(`${LI_BASE}${path}`, {
    headers: {
      "Authorization": `Bearer ${token}`,
      "LinkedIn-Version": "202401",
      "X-Restli-Protocol-Version": "2.0.0",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LinkedIn API ${res.status}: ${body}`);
  }
  return res.json();
}

// ─── METRICS LINKEDIN ─────────────────────────────────────────────────────────
async function fetchFollowers(orgId, token) {
  try {
    const data = await liGet(
      `/organizationalEntityFollowerStatistics?q=organizationalEntity&organizationalEntity=urn%3Ali%3Aorganization%3A${orgId}`,
      token
    );
    const elements = data.elements ?? [];
    if (elements.length === 0) return { total: null, organic: null, paid: null };
    const stats = elements[0];
    const total   = (stats.totalFollowerCounts?.organicFollowerCount ?? 0) + (stats.totalFollowerCounts?.paidFollowerCount ?? 0);
    const organic = stats.totalFollowerCounts?.organicFollowerCount ?? null;
    const paid    = stats.totalFollowerCounts?.paidFollowerCount ?? null;
    return { total, organic, paid };
  } catch (e) {
    console.error("fetchFollowers error:", e.message);
    return { total: null, organic: null, paid: null };
  }
}

async function fetchPageStats(orgId, token) {
  try {
    const { start, end } = getCurrentWeekRange();
    const data = await liGet(
      `/organizationPageStatistics?q=organization&organization=urn%3Ali%3Aorganization%3A${orgId}&timeIntervals.timeGranularityType=WEEK&timeIntervals.timeRange.start=${start}&timeIntervals.timeRange.end=${end}`,
      token
    );
    const elements = data.elements ?? [];
    let views = 0, visitors = 0;
    for (const el of elements) {
      views    += el.totalPageStatistics?.views?.allPageViews?.pageViews ?? 0;
      visitors += el.totalPageStatistics?.views?.allPageViews?.uniquePageViews ?? 0;
    }
    return { views: views || null, visitors: visitors || null };
  } catch (e) {
    console.error("fetchPageStats error:", e.message);
    return { views: null, visitors: null };
  }
}

async function fetchShareStats(orgId, token) {
  try {
    const { start, end } = getCurrentWeekRange();
    const data = await liGet(
      `/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=urn%3Ali%3Aorganization%3A${orgId}&timeIntervals.timeGranularityType=WEEK&timeIntervals.timeRange.start=${start}&timeIntervals.timeRange.end=${end}`,
      token
    );
    const elements = data.elements ?? [];
    let impressions = 0, clicks = 0, likes = 0, comments = 0, shares = 0;
    for (const el of elements) {
      const s = el.totalShareStatistics ?? {};
      impressions += s.impressionCount  ?? 0;
      clicks      += s.clickCount       ?? 0;
      likes       += s.likeCount        ?? 0;
      comments    += s.commentCount     ?? 0;
      shares      += s.shareCount       ?? 0;
    }
    const engagement = impressions > 0 ? ((clicks + likes + comments + shares) / impressions * 100) : null;
    return {
      impressions: impressions || null,
      clicks:      clicks      || null,
      likes:       likes       || null,
      comments:    comments    || null,
      shares:      shares      || null,
      engagementRate: engagement ? parseFloat(engagement.toFixed(2)) : null,
    };
  } catch (e) {
    console.error("fetchShareStats error:", e.message);
    return { impressions: null, clicks: null, likes: null, comments: null, shares: null, engagementRate: null };
  }
}

// ─── GOOGLE SHEETS AUTH ────────────────────────────────────────────────────────
async function getGoogleAccessToken(email, privateKeyRaw) {
  const privateKey = privateKeyRaw.replace(/\\n/g, "\n");
  const now = Math.floor(Date.now() / 1000);
  const header  = { alg: "RS256", typ: "JWT" };
  const payload = { iss: email, scope: "https://www.googleapis.com/auth/spreadsheets", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 };
  const enc = v => btoa(JSON.stringify(v)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  const signingInput = `${enc(header)}.${enc(payload)}`;
  const pemBody = privateKey.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\n/g, "");
  const keyBuffer = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey("pkcs8", keyBuffer.buffer, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, new TextEncoder().encode(signingInput));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  const jwt = `${signingInput}.${sigB64}`;
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) throw new Error(`Google auth failed: ${JSON.stringify(tokenData)}`);
  return tokenData.access_token;
}

async function weekExists(gToken, week) {
  const range = encodeURIComponent(`${LINKEDIN_TAB}!A:A`);
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}`, {
    headers: { "Authorization": `Bearer ${gToken}` },
  });
  const data = await res.json();
  return (data.values || []).some(r => r[0] === week);
}

async function appendRow(gToken, row) {
  const range = encodeURIComponent(`${LINKEDIN_TAB}!A:K`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Authorization": `Bearer ${gToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values: [row] }),
  });
  return res.json();
}

async function readSheet(gToken) {
  const range = encodeURIComponent(`${LINKEDIN_TAB}!A:K`);
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}`, {
    headers: { "Authorization": `Bearer ${gToken}` },
  });
  const data = await res.json();
  return (data.values || []).slice(1);
}

// ─── HANDLER ──────────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  const type    = req.query.type || "status";
  const liToken = process.env.LINKEDIN_ACCESS_TOKEN;
  const orgId   = process.env.LINKEDIN_ORGANIZATION_ID || "10981269";
  const saEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const saKey   = process.env.GOOGLE_PRIVATE_KEY;

  // ── Status ────────────────────────────────────────────────────────────────
  if (type === "status") {
    return res.status(200).json({
      linkedin: !!liToken,
      sheets:   !!(saEmail && saKey),
      orgId,
      week: getCurrentWeekLabel(),
    });
  }

  // ── Sheet : lit LinkedIn_Weekly ───────────────────────────────────────────
  if (type === "sheet") {
    if (!saEmail || !saKey) return res.status(503).json({ error: "Google credentials manquants" });
    try {
      res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate");
      const gToken = await getGoogleAccessToken(saEmail, saKey);
      const rows   = await readSheet(gToken);
      // Colonnes : Semaine | Followers | Followers_Delta | PageViews | UniqueVisitors |
      //            Impressions | Clicks | Likes | Comments | Shares | EngagementRate
      const history = rows
        .filter(r => r[0])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
        .map(r => ({
          week:           r[0],
          followers:      parseFloat(r[1])  || null,
          followersDelta: parseFloat(r[2])  || null,
          pageViews:      parseFloat(r[3])  || null,
          uniqueVisitors: parseFloat(r[4])  || null,
          impressions:    parseFloat(r[5])  || null,
          clicks:         parseFloat(r[6])  || null,
          likes:          parseFloat(r[7])  || null,
          comments:       parseFloat(r[8])  || null,
          shares:         parseFloat(r[9])  || null,
          engagementRate: parseFloat(r[10]) || null,
        }));
      return res.status(200).json({ history, fetchedAt: new Date().toISOString() });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  // ── Fetch : collecte LinkedIn + écrit dans Sheets ────────────────────────
  if (type === "fetch") {
    if (!liToken) return res.status(503).json({ error: "LINKEDIN_ACCESS_TOKEN manquant" });
    if (!saEmail || !saKey) return res.status(503).json({ error: "Google credentials manquants" });
    try {
      const week = getCurrentWeekLabel();
      const gToken = await getGoogleAccessToken(saEmail, saKey);

      const exists = await weekExists(gToken, week);
      if (exists) return res.status(200).json({ skipped: true, reason: `${week} déjà présente` });

      const [followers, pageStats, shareStats] = await Promise.all([
        fetchFollowers(orgId, liToken),
        fetchPageStats(orgId, liToken),
        fetchShareStats(orgId, liToken),
      ]);

      // Calcule le delta followers vs semaine précédente
      const rows = await readSheet(gToken);
      const sorted = rows.filter(r => r[0]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
      const lastRow = sorted.at(-1);
      const prevFollowers = lastRow ? parseFloat(lastRow[1]) || null : null;
      const delta = followers.total != null && prevFollowers != null ? followers.total - prevFollowers : null;

      const row = [
        week,
        followers.total      ?? null,
        delta                ?? null,
        pageStats.views      ?? null,
        pageStats.visitors   ?? null,
        shareStats.impressions  ?? null,
        shareStats.clicks       ?? null,
        shareStats.likes        ?? null,
        shareStats.comments     ?? null,
        shareStats.shares       ?? null,
        shareStats.engagementRate ?? null,
      ];

      await appendRow(gToken, row);
      return res.status(200).json({
        written: true, week, followers, pageStats, shareStats, delta,
        fetchedAt: new Date().toISOString(),
      });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  return res.status(400).json({ error: `Type inconnu : ${type}` });
};
