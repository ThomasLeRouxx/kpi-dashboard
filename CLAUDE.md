Tu travailles sur le repo GitHub ThomasLeRouxx/kpi-dashboard.
Stack : src/App.jsx (React/Vite), api/kaito.js + api/airtable.js (serverless Vercel).
Déployé sur : https://kpi-dashboard-neon.vercel.app

─────────────────────────────────────────────
## DIAGNOSTIC CONFIRMÉ

### Problème 1 — Onglet Marketing vide
L'endpoint /api/kaito?type=marketing répond mais retourne toutes
les valeurs mindshare à 0 et smartFollowers/mentions à null.
Cause : l'API REST Kaito (https://api.kaito.ai/api/v1/mindshare)
ne renvoie aucune donnée avec la clé actuelle pour ces appels.

La vraie source de données qui fonctionne est le MCP Kaito,
accessible via le workflow GitHub Actions (scripts/kaito_weekly_claude.js).
Ce script tourne déjà hebdomadairement et écrit dans Google Sheets.

### Problème 2 — KPI mindshare (KPI id=9) historique absent
L'historique du mindshare doit venir de l'onglet Historique
du Google Sheet (GID=1449053835), qui est alimenté par
le script kaito_weekly_claude.js chaque semaine.

### Problème 3 — Stages Sales mal mappés
Les stages Airtable "Business Call" et "Agreement Phase"
doivent être classés comme "Advanced" dans le dashboard.

─────────────────────────────────────────────
## TÂCHE 1 — Onglet Marketing : remplacer l'appel REST Kaito par lecture Google Sheets

### Contexte
Le script scripts/kaito_weekly_claude.js utilise déjà le MCP Kaito
(outils : kaito_mindshare, kaito_smart_followers, kaito_mentions,
kaito_engagement) et écrit les résultats dans Google Sheets.

### Solution
Enrichir le script kaito_weekly_claude.js pour qu'il écrive aussi,
dans un onglet Google Sheets dédié "Marketing", les données
nécessaires à l'onglet Performance Marketing du dashboard.

Crée ou met à jour l'onglet "Marketing" du Sheet avec ces colonnes :
  Semaine | SmartFollowers | SmartFollowers_Change | Mentions_7d |
  Impressions_7d | Engagement_7d | Smart_Engagement_7d |
  Mindshare_RLC_Pct | TEE_Rank | Fetched_At

Le script doit appeler (via MCP, logique déjà en place) :
- kaito_smart_followers(username="iEx_ec", mode="count")
  → SmartFollowers du jour
- kaito_mentions(token="RLC", start_date=lundi_semaine, end_date=dimanche)
  → total mentions sur 7 jours
- kaito_engagement(token="RLC", start_date=lundi, end_date=dimanche)
  → total engagement + smart_engagement sur 7 jours
- kaito_mindshare(token="RLC", start_date=lundi, end_date=dimanche)
  → mindshare % moyen sur la semaine
- Mindshare Privacy Infra (déjà calculé dans le script) = part RLC
  dans le pool de 11 tokens

Pour SmartFollowers_Change : comparer le count du jour avec celui
de la semaine précédente (lire la dernière ligne du Sheet Marketing).

### Adapter l'API Vercel
Dans api/kaito.js, ajouter type=marketing_sheet qui lit
l'onglet "Marketing" du Google Sheet (via les credentials
GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY déjà configurés)
et retourne la dernière ligne + les N dernières semaines pour
les graphiques d'évolution.

Format de réponse attendu :
{
  "week": "2026-W12",
  "smartFollowers": { "count": 1234, "weekly_change": +12 },
  "mentions": { "total": 456, "weekly_change_pct": +5.2 },
  "engagement": { "total": 789, "smart": 45 },
  "mindshareRLC": { "value": 2.45, "unit": "%" },
  "teeRank": 1,
  "history": [  ← 12 dernières semaines pour les sparklines
    { "week": "2026-W01", "smartFollowers": 1200, "mentions": 400, ... },
    ...
  ]
}

### Dans App.jsx
fetchKaitoMarketing() doit appeler /api/kaito?type=marketing_sheet
(au lieu de type=marketing qui appelait l'API REST).

L'onglet Marketing doit afficher :
- KPI cards : Smart Followers + évolution, Mentions 7j, 
  Engagement total, Smart Engagement, Mindshare RLC%
- Sparklines d'évolution sur 12 semaines pour SF et mentions
- Treemap mindshare (déjà fonctionnel depuis l'historique)
- Classement TEE

─────────────────────────────────────────────
## TÂCHE 2 — Historique KPI Mindshare (KPI id=9)

### Contexte
Dans fetchData() de App.jsx, le KPI id="9" (Maintain 2.61%
privacy infra mindshare) affiche 0% car :
1. L'appel live /api/kaito?type=mindshare renvoie value=0
2. Le fallback sur l'historique Sheets ne trouve pas de données

### Solution
L'historique existe dans le Sheet "Historique" (GID=1449053835)
sous la forme : Semaine | Nom du KPI | ID | Valeur | Unité
Le script kaito_weekly_claude.js y écrit chaque semaine.

Dans App.jsx, dans le bloc `if (kid === "9")` de setKpis() :
- Si le live Kaito retourne 0, NE PAS afficher 0%
- Chercher dans histData les entrées avec kpi_id="9"
- Prendre la dernière valeur connue (semaine la plus récente)
- Calculer progress_pct = valeur / 2.61 (target)
- displayLabel = "${valeur.toFixed(2)}% (S${semaine})"
- Afficher l'historique complet dans la sparkline du modal

Le KPI doit toujours afficher la meilleure donnée disponible :
live Kaito si > 0, sinon dernière valeur Sheets.

─────────────────────────────────────────────
## TÂCHE 3 — Stages Airtable : classer Business Call et Agreement Phase en "Advanced"

### Dans api/airtable.js
Mettre à jour les constantes et la logique de mapping :

// Stages actifs (prospects chauds)
const ACTIVE_STAGES = [
  'Discovery Call', 'ETHcc meeting',
  'Technical Call', 'Architecture',
  'Business Call', 'Agreement Phase', 'Advanced'
];

// Mapping funnel
const FUNNEL_STEPS = [
  { key:'identified', label:'Identified',  stages:['Identified','Researched'] },
  { key:'contacted',  label:'Contacted',   stages:['Contacted'] },
  { key:'discovery',  label:'Discovery',   stages:['Discovery Call'] },
  { key:'qualified',  label:'Qualified',   stages:['Technical Call','Architecture'] },
  { key:'advanced',   label:'Advanced',    stages:['Advanced','Business Call','Agreement Phase'] },
  { key:'lost',       label:'Closed Lost', stages:['Not Ready Yet','Not Interested'] },
];

Remplacer le calcul actuel de `funnel` et `activeProspects`
par ce nouveau mapping.

Dans le payload retourné, adapter `funnel` pour utiliser
FUNNEL_STEPS (chaque item : { key, label, stages, count }).

### Dans App.jsx
Le composant FunnelBar (ou nouveau composant funnel) doit
utiliser les labels "Identified / Contacted / Discovery /
Qualified / Advanced / Closed Lost" depuis le payload.

Les badges de statut dans ProspectCard doivent mapper :
- 'Business Call' → afficher "Advanced" (badge jaune #FCD15A)
- 'Agreement Phase' → afficher "Advanced" (badge jaune #FCD15A)

─────────────────────────────────────────────
## CONTRAINTES

- Ne pas modifier la structure des variables d'environnement Vercel existantes
- Garder le design system : IBM Plex Mono pour valeurs, DM Sans pour labels,
  palette #FCD15A / #1D1D24 / #f4f6fa
- Commiter dans cet ordre :
  1. api/airtable.js (TÂCHE 3)
  2. scripts/kaito_weekly_claude.js (TÂCHE 1 — enrichissement)
  3. api/kaito.js (TÂCHE 1 — nouveau endpoint marketing_sheet)
  4. src/App.jsx (TÂCHES 1 + 2 + 3)
- Après chaque fichier, attendre confirmation avant de passer au suivant
- Tester api/airtable.js avec : curl https://kpi-dashboard-neon.vercel.app/api/airtable?type=status | jq .funnel
EOF