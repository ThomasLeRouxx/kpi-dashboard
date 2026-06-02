/**
 * /api/linkedin-auth
 *
 * Deux usages :
 *   GET /api/linkedin-auth?action=login
 *     → redirige vers l'écran d'autorisation LinkedIn
 *
 *   GET /api/linkedin-auth?code=xxx&state=xxx   (callback LinkedIn)
 *     → échange le code contre access_token + refresh_token et les affiche
 *       pour que tu puisses les copier dans tes variables d'environnement
 *
 * Variables d'environnement requises :
 *   LINKEDIN_CLIENT_ID
 *   LINKEDIN_CLIENT_SECRET
 *   LINKEDIN_REDIRECT_URI   ex: https://ton-dashboard.vercel.app/api/linkedin-auth
 */

const SCOPES = ["r_organization_social", "r_organization_admin", "rw_organization_admin"].join(" ");

module.exports = async function handler(req, res) {
  const clientId     = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
  const redirectUri  = process.env.LINKEDIN_REDIRECT_URI;

  // ── Action login : génère l'URL d'autorisation ────────────────────────────
  if (req.query.action === "login") {
    if (!clientId || !redirectUri) {
      return res.status(500).send("LINKEDIN_CLIENT_ID ou LINKEDIN_REDIRECT_URI manquant");
    }
    const state = Math.random().toString(36).slice(2);
    const url = `https://www.linkedin.com/oauth/v2/authorization?` +
      `response_type=code` +
      `&client_id=${clientId}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=${encodeURIComponent(SCOPES)}` +
      `&state=${state}`;
    return res.redirect(url);
  }

  // ── Callback : échange le code contre les tokens ──────────────────────────
  if (req.query.code) {
    if (!clientId || !clientSecret || !redirectUri) {
      return res.status(500).send("Variables d'environnement LinkedIn manquantes");
    }
    try {
      const tokenRes = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type:    "authorization_code",
          code:          req.query.code,
          redirect_uri:  redirectUri,
          client_id:     clientId,
          client_secret: clientSecret,
        }),
      });
      const data = await tokenRes.json();
      if (!data.access_token) {
        return res.status(400).send(`<pre>Erreur LinkedIn:\n${JSON.stringify(data, null, 2)}</pre>`);
      }
      // Affiche les tokens à copier dans les variables d'environnement
      return res.status(200).send(`
        <html><body style="font-family:monospace;padding:40px;background:#0f0f0f;color:#e0e0e0">
          <h2 style="color:#FCD15A">✅ Authentification LinkedIn réussie</h2>
          <p>Copie ces valeurs dans tes variables d'environnement Vercel et secrets GitHub :</p>
          <hr style="border-color:#333"/>
          <p><b style="color:#3B82F6">LINKEDIN_ACCESS_TOKEN</b></p>
          <textarea rows="4" style="width:100%;background:#1a1a1a;color:#10B981;border:1px solid #333;padding:8px;font-family:monospace">${data.access_token}</textarea>
          <p style="color:#94A3B8;font-size:12px">Expire dans ${Math.round((data.expires_in ?? 5184000) / 86400)} jours</p>
          ${data.refresh_token ? `
          <p><b style="color:#3B82F6">LINKEDIN_REFRESH_TOKEN</b></p>
          <textarea rows="2" style="width:100%;background:#1a1a1a;color:#10B981;border:1px solid #333;padding:8px;font-family:monospace">${data.refresh_token}</textarea>
          <p style="color:#94A3B8;font-size:12px">Refresh token expire dans ${Math.round((data.refresh_token_expires_in ?? 31536000) / 86400)} jours</p>
          ` : ""}
          <p style="color:#94A3B8;margin-top:32px">Tu peux fermer cette page après avoir copié les tokens.</p>
        </body></html>
      `);
    } catch (e) {
      return res.status(500).send(`Erreur: ${e.message}`);
    }
  }

  // ── Refresh token ─────────────────────────────────────────────────────────
  if (req.query.action === "refresh") {
    const refreshToken = process.env.LINKEDIN_REFRESH_TOKEN;
    if (!refreshToken) return res.status(400).json({ error: "LINKEDIN_REFRESH_TOKEN manquant" });
    const tokenRes = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type:    "refresh_token",
        refresh_token: refreshToken,
        client_id:     clientId,
        client_secret: clientSecret,
      }),
    });
    const data = await tokenRes.json();
    return res.status(200).json(data);
  }

  return res.status(400).json({ error: "Paramètre manquant. Utilise ?action=login pour démarrer." });
};
