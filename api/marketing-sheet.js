const SHEET_URL = "https://docs.google.com/spreadsheets/d/1ax7iv9ZINDkhvpDlc_AdofsghKBSfIaO_L54qoHFgV8/export?format=csv&gid=0";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  try {
    const r = await fetch(SHEET_URL, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r.ok) return res.status(502).json({ error: `Sheet responded ${r.status}` });
    const csv = await r.text();
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=60");
    return res.status(200).send(csv);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
