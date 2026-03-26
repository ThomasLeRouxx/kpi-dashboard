Tu travailles sur le repo GitHub ThomasLeRouxx/kpi-dashboard (React + Vite, déployé sur Vercel).
Stack : src/App.jsx (front React), api/kaito.js (serverless Vercel), api/airtable.js (serverless Vercel).

---

## CONTEXTE TECHNIQUE

### Google Sheets
- SHEET_ID    = "1Mp8SVYlWw-P6z0ty_JuBEhZtpzqUzMYtBuO9z0knZ4I"
- GID_MASTER  = "377128355"   → onglet KPIs (colonnes : ID, KPI, Département, Type, Target, Baseline, Current, Progression, Statut, Poids)
- GID_HISTORY = "1449053835"  → onglet Historique (colonnes : Semaine, KPI_ID, Valeur)
- URL pattern : `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`

### API Kaito (via /api/kaito.js Vercel serverless)
- GET /api/kaito?type=mindshare → { value, unit, week, detail:{ rlc_raw, total_raw, breakdown:[{token,value}] } }
- GET /api/kaito?type=tee_rank  → { value, week, detail:{ ranking:[{rank,token,mindshare}] } }
- GET /api/kaito?type=marketing → { week, smartFollowers:{count,weekly_change}, mentions:{total,impressions,daily}, mindshare:{...}, teeRank:{...} }
- GET /api/kaito?type=status    → { enabled, dataWeek, dateRange:{start,end} }

### API Airtable (via /api/airtable.js Vercel serverless)
- GET /api/airtable?type=status → payload complet incluant :
  { enabled, total, totalReponse, totalMeeting, totalContacted, totalDiscovery,
    conversionRates, funnel, byOwner, byVerticale, bySegment, topBlockers,
    activeProspects, byWeek:[{week,total,reponse,meeting,discovery}],
    byMonth:[{month,total,reponse,meeting,discovery}] }
- Champs Airtable disponibles par lead : name, company, owner, verticale, usecase, 
  reponse, meetingDone, stage, tvl, segment, blockers, nextStep, createdAt
- Stages Airtable : Identified, Researched, Contacted, Discovery Call, Technical Call,
  Architecture, Advanced, Not Ready Yet, Not Interested

---

## CORRECTIONS À APPORTER

### 1. ONGLET KPI — Mindshare KPI-9 ne récupère pas les données

**Symptôme :** Le KPI mindshare (id="9") affiche 0% malgré que /api/kaito?type=mindshare réponde correctement.

**Cause probable :** Dans fetchData(), la logique qui injecte les données Kaito live dans le KPI id="9"
utilise `kaitoData.mindshare` mais le state kaitoData est vide au moment du premier rendu
(closure stale) — le fix `fetchData(newKaitoData)` passe kaitoData en paramètre mais
la fonction doit l'utiliser effectivement via le paramètre reçu, pas via le state.

**Fix attendu :**
- Dans fetchData(liveKaitoData), vérifier que le paramètre est bien utilisé (pas le state kaitoData)
  pour le override KPI-9 et KPI-10
- Si /api/kaito?type=mindshare renvoie value=0 (données Kaito W-2 vides), fallback sur
  les données Historique Sheets pour KPI-9 au lieu d'afficher 0%
- Tester : /api/kaito?type=mindshare doit retourner un breakdown avec des valeurs > 0
  pour que le calcul fonctionne ; si toutes les valeurs sont 0 (API Kaito retourne 0 pour
  tous les tokens), afficher la dernière valeur connue depuis l'historique Sheets

---

### 2. PERFORMANCE SALES — Graphique Reach (nouveaux leads) → passer en ligne

**Changement :** Remplacer le composant `ReachChart` (barres) par un graphique **linéaire SVG**.

**Specs :**
- Axe X : labels de semaine (ex: W10, W11...) ou mois (Jan, Fév...)
- Axe Y : nombre de leads, avec graduations automatiques
- 3 séries sur le même graphe :
  - 🔵 Total leads créés  (couleur #3B82F6)
  - 🟣 Réponses obtenues  (couleur #8B5CF6)
  - 🟡 Meetings bookés    (couleur #F59E0B)
- Toggle Par semaine / Par mois (existant à garder)
- Points sur la ligne avec tooltip au hover (valeur + label)
- Légende en dessous
- Données : byWeek et byMonth depuis /api/airtable?type=status

---

### 3. PERFORMANCE SALES — Ajouter stats Usecase + améliorer Blockers

**A. Section Usecase (nouvelle section à ajouter après "Par Segment") :**
- Agréger les leads par champ `usecase` (disponible dans bySegment ou depuis les leads)
- Ajouter dans api/airtable.js le calcul `byUsecase` dans le payload :
  `byUsecase: [{usecase, count, meetings, discovery}]`
  (même logique que bySegment mais sur le champ usecase)
- Affichage : barres horizontales + count, trié par count desc

**B. Améliorer l'affichage des Blockers :**
- Actuellement : pills avec emoji ⚠ + nom + count
- Nouveau : liste ordonnée avec barre de progression horizontale,
  la barre = count/maxCount, couleur rouge dégradée selon rang
  (le plus fréquent = rouge vif #EF4444, les suivants = opacity décroissante)
- Afficher les 6 premiers blockers max
- Ajouter le total en header : "X blockers identifiés"

---

### 4. PERFORMANCE SALES — Refonte du Funnel Pipeline

**Mapping des stages Airtable → étapes funnel :**
| Étape Funnel   | Stages Airtable correspondants                  |
|----------------|------------------------------------------------|
| Identified     | Identified, Researched                          |
| Contacted      | Contacted                                       |
| Discovery      | Discovery Call                                  |
| Qualified      | Technical Call, Architecture                    |
| Advanced       | Advanced                                        |
| Closed Lost    | Not Ready Yet, Not Interested                   |

**Affichage :**
- Abandon le composant FunnelBar actuel (barres horizontales simples)
- Nouveau design : funnel visuel en entonnoir (SVG ou CSS trapèze)
  - Chaque étape = trapèze de largeur décroissante
  - Couleur dégradée : Identified=#94A3B8 → Contacted=#3B82F6 → Discovery=#8B5CF6
    → Qualified=#F59E0B → Advanced=#FCD15A → Closed Lost=#EF4444
  - Afficher : nom de l'étape + count + taux de conversion depuis l'étape précédente
  - Responsive : sur mobile passe en liste verticale

**Modifier api/airtable.js :**
- Remplacer `funnel` par le nouveau mapping :
```js
const FUNNEL_STEPS = [
  { key:'identified', label:'Identified',  stages:['Identified','Researched'] },
  { key:'contacted',  label:'Contacted',   stages:['Contacted'] },
  { key:'discovery',  label:'Discovery',   stages:['Discovery Call'] },
  { key:'qualified',  label:'Qualified',   stages:['Technical Call','Architecture'] },
  { key:'advanced',   label:'Advanced',    stages:['Advanced'] },
  { key:'lost',       label:'Closed Lost', stages:['Not Ready Yet','Not Interested'] },
];
const funnel = FUNNEL_STEPS.map(step => ({
  ...step,
  count: leads.filter(l => step.stages.includes(l.stage)).length,
}));
```

---

### 5. PERFORMANCE MARKETING — Onglet vide (ne récupère rien)

**Symptôme :** L'onglet affiche soit un spinner infini soit "Kaito Marketing non disponible"
même si /api/kaito?type=marketing répond.

**Cause probable :** fetchKaitoMarketing() fait un fetch vers `/api/kaito?type=marketing`
qui est un **nouvel endpoint** ajouté dans api/kaito.js.
Si Vercel n'a pas redéployé avec le nouveau kaito.js, l'endpoint n'existe pas encore → 404/400.
Vérifier d'abord : curl https://kpi-dashboard-neon.vercel.app/api/kaito?type=marketing

**Si l'endpoint répond correctement mais l'UI est vide :**
Les champs retournés par /api/kaito?type=marketing peuvent être null si l'API Kaito
ne supporte pas les endpoints smart_followers et mentions (403/404 silencieux).
Dans ce cas le payload ressemble à :
```json
{ "week":"2026-W11", "smartFollowers":{"count":null}, "mentions":{"total":null},
  "mindshare":{...valeurs réelles...}, "teeRank":{...valeurs réelles...} }
```

**Fix :**
- Dans MarketingDashboard, ne pas conditionner l'affichage sur `if (!data)` seulement —
  afficher le dashboard dès que data existe même si certains champs sont null
- Les KPI cards avec valeur null doivent afficher "—" sans faire crasher le composant
- Toujours afficher le treemap Mindshare et le classement TEE (ces données fonctionnent)
- Pour smartFollowers et mentions nuls : afficher une card "Données non disponibles"
  avec un message expliquant que l'API Kaito ne supporte pas encore ces endpoints
- Ajouter dans api/kaito.js un fallback pour les endpoints qui font 403/404 :
  retourner les valeurs null sans throw pour ne pas bloquer le payload entier

**Données qui doivent toujours s'afficher (proviennent de computeMindshare + computeTeeRank
qui fonctionnent) :**
- Treemap mindshare 11 tokens (ZAMA,AZTEC,ARCIUM,MIDEN,ALEO,RAIL,RLC,ROSE,PHA,SCRT,INCO)
- Classement TEE : RLC vs ROSE vs PHA vs SCRT
- Part RLC dans Privacy Infra (%)
- Rang TEE actuel

---

## CONTRAINTES GÉNÉRALES

- Garder le design system existant : palette #FCD15A/#1D1D24/#f4f6fa,
  font IBM Plex Mono pour les valeurs, DM Sans pour les labels
- Tous les composants restent dans src/App.jsx (pas de fichiers séparés)
- Ne pas casser les fonctionnalités existantes (onglet KPI, token chart, modal)
- Les serverless functions restent dans api/airtable.js et api/kaito.js
- Tester les endpoints en local avec `vercel dev` avant commit
- Commiter séparément : 1 commit par section (airtable.js, kaito.js, App.jsx)
EOF
