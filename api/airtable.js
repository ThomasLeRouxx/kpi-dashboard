/**
 * Vercel Serverless Function – Proxy Airtable API
 * Fichier : /api/airtable.js
 *
 * Changements v2 :
 *  - Expose r.createdTime → createdAt sur chaque lead
 *  - Calcule byWeek  (semaines calendaires lun-dim, 12 dernières)
 *  - Calcule byMonth (12 derniers mois)
 *  - Fix Discovery dans ConversionFlow : expose totalDiscovery
 */

const maxDuration = 30;
exports.maxDuration = maxDuration;

// Stages utilisés pour le stageBreak par owner
const FUNNEL_STAGES = ['Identified', 'Researched', 'Contacted', 'Discovery Call', 'Technical Call', 'Architecture', 'Advanced', 'Not Ready Yet', 'Not Interested'];
const ACTIVE_STAGES = [
  'Discovery Call', 'ETHcc meeting',
  'Technical Call', 'Architecture',
  'Business Call', 'Agreement Phase', 'Advanced',
];

// Nouveau mapping entonnoir pour l'onglet Sales
const FUNNEL_STEPS = [
  { key:'identified', label:'Identified',  stages:['Identified','Researched'] },
  { key:'contacted',  label:'Contacted',   stages:['Contacted'] },
  { key:'discovery',  label:'Discovery',   stages:['Discovery Call'] },
  { key:'qualified',  label:'Qualified',   stages:['Technical Call','Architecture'] },
  { key:'advanced',   label:'Advanced',    stages:['Advanced','Business Call','Agreement Phase'] },
  { key:'lost',       label:'Closed Lost', stages:['Not Ready Yet','Not Interested'] },
];

function toStr(v) {
  if (Array.isArray(v)) return v.join(', ');
  if (v === null || v === undefined) return '';
  return String(v);
}

function toBool(v) {
  return v === true || v === 'checked';
}

/** Retourne l'étiquette "YYYY-Www" (ISO lun-dim) d'une date */
function toISOWeek(dateStr) {
  const d = new Date(dateStr);
  // Jeudi de la semaine ISO
  const thu = new Date(d);
  thu.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(thu.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((thu - yearStart) / 86400000 + 1) / 7);
  const y = thu.getUTCFullYear();
  return `${y}-W${String(week).padStart(2, '0')}`;
}

/** Retourne "YYYY-MM" */
function toYearMonth(dateStr) {
  const d = new Date(dateStr);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const apiKey  = process.env.AIRTABLE_API_KEY;
  const baseId  = process.env.AIRTABLE_BASE_ID;
  const tableId = process.env.AIRTABLE_TABLE_ID || 'Leads';

  if (!apiKey || !baseId) {
    return res.status(503).json({ error: 'AIRTABLE_API_KEY ou AIRTABLE_BASE_ID manquant', enabled: false });
  }

  try {
    let allRecords = [];
    let offset = null;

    do {
      const url = new URL('https://api.airtable.com/v0/' + baseId + '/' + encodeURIComponent(tableId));
      url.searchParams.set('pageSize', '100');
      if (offset) url.searchParams.set('offset', offset);

      const response = await fetch(url.toString(), {
        headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error('Airtable error ' + response.status + ': ' + (err.error && err.error.message ? err.error.message : JSON.stringify(err)));
      }

      const data = await response.json();
      allRecords = allRecords.concat(data.records);
      offset = data.offset || null;
    } while (offset);

    const leads = allRecords.map(function(r) {
      const f = r.fields || {};
      return {
        id:          r.id,
        createdAt:   r.createdTime || null,   // ← NOUVEAU : date de création Airtable
        name:        toStr(f['Lead Name']),
        company:     toStr(f['Company / Org']),
        website:     toStr(f['Website']),
        twitter:     toStr(f['X/Twitter']),
        owner:       toStr(f['Lead']),
        verticale:   toStr(f['Verticale']),
        usecase:     toStr(f['Usecase']),
        reponse:     toBool(f['Réponse']),
        meetingDone: toBool(f['Meeting done']),
        stage:       toStr(f['Stage']),
        tvl:         toStr(f['TVL']),
        segment:     toStr(f['Lead Segment']),
        recentNews:  toStr(f['Recent News']).substring(0, 200),
        blockers:    toStr(f['Blockers']),
        feedback:    toStr(f['Feedback']),
        nextStep:    toStr(f['Next Step']),
      };
    });

    // ── Metrics globales ──────────────────────────────────────────────────────
    const total          = leads.length;
    const totalReponse   = leads.filter(l => l.reponse).length;
    const totalMeeting   = leads.filter(l => l.meetingDone).length;
    const totalContacted = leads.filter(l => l.stage && !['Identified', 'Researched'].includes(l.stage)).length;
    const totalDiscovery = leads.filter(l => ACTIVE_STAGES.includes(l.stage)).length;

    const conversionRates = {
      identifiedToContacted: total > 0 ? Math.round(totalContacted / total * 100) : 0,
      contactedToReponse:    totalContacted > 0 ? Math.round(totalReponse / totalContacted * 100) : 0,
      reponseToMeeting:      totalReponse > 0 ? Math.round(totalMeeting / totalReponse * 100) : 0,
      meetingToDiscovery:    totalMeeting > 0 ? Math.round(totalDiscovery / totalMeeting * 100) : 0,
    };

    // ── Funnel (mapping entonnoir avec regroupement de stages) ────────────────
    const funnel = FUNNEL_STEPS.map(step => ({
      ...step,
      count: leads.filter(l => step.stages.includes(l.stage)).length,
    }));

    // ── Par owner ─────────────────────────────────────────────────────────────
    const ownerNames = [...new Set(leads.map(l => l.owner).filter(Boolean))];
    const byOwner = ownerNames.map(owner => {
      const ol   = leads.filter(l => l.owner === owner);
      const rep  = ol.filter(l => l.reponse).length;
      const meet = ol.filter(l => l.meetingDone).length;
      const disc = ol.filter(l => ACTIVE_STAGES.includes(l.stage)).length;
      const stageBreak = {};
      FUNNEL_STAGES.forEach(s => { stageBreak[s] = ol.filter(l => l.stage === s).length; });
      return { owner, total: ol.length, reponse: rep, meeting: meet, discovery: disc,
        tauxRep:  ol.length > 0 ? Math.round((rep  / ol.length) * 100) : 0,
        tauxMeet: ol.length > 0 ? Math.round((meet / ol.length) * 100) : 0,
        stageBreak };
    });

    // ── Par verticale ─────────────────────────────────────────────────────────
    const vertNames  = [...new Set(leads.map(l => l.verticale).filter(Boolean))];
    const byVerticale = vertNames.map(v => ({
      verticale: v,
      count:    leads.filter(l => l.verticale === v).length,
      meetings: leads.filter(l => l.verticale === v && l.meetingDone).length,
    }));

    // ── Par segment ───────────────────────────────────────────────────────────
    const segNames  = [...new Set(leads.map(l => l.segment).filter(Boolean))];
    const bySegment = segNames.map(s => ({
      segment:   s,
      count:     leads.filter(l => l.segment === s).length,
      meetings:  leads.filter(l => l.segment === s && l.meetingDone).length,
      discovery: leads.filter(l => l.segment === s && ACTIVE_STAGES.includes(l.stage)).length,
    }));

    // ── Par usecase ────────────────────────────────────────────────────────────
    const usecaseNames = [...new Set(leads.map(l => l.usecase).filter(Boolean))];
    const byUsecase = usecaseNames.map(u => ({
      usecase:   u,
      count:     leads.filter(l => l.usecase === u).length,
      meetings:  leads.filter(l => l.usecase === u && l.meetingDone).length,
      discovery: leads.filter(l => l.usecase === u && ACTIVE_STAGES.includes(l.stage)).length,
    })).sort((a, b) => b.count - a.count);

    // ── Top blockers ──────────────────────────────────────────────────────────
    const blockerMap = {};
    leads.forEach(l => {
      if (!l.blockers) return;
      l.blockers.split(',').forEach(b => {
        const key = b.trim();
        if (key) blockerMap[key] = (blockerMap[key] || 0) + 1;
      });
    });
    const topBlockers = Object.entries(blockerMap)
      .sort((a, b) => b[1] - a[1]).slice(0, 6)
      .map(([name, count]) => ({ name, count }));

    // ── Active prospects ──────────────────────────────────────────────────────
    const activeProspects = leads
      .filter(l => ACTIVE_STAGES.includes(l.stage))
      .map(l => ({ company: l.company, stage: l.stage, owner: l.owner,
        verticale: l.verticale, tvl: l.tvl, segment: l.segment,
        recentNews: l.recentNews, nextStep: l.nextStep }));

    // ── NOUVEAU : Reach par semaine calendaire ────────────────────────────────
    // On groupe les leads par semaine ISO de leur createdAt
    const weekMap = {};
    leads.forEach(l => {
      if (!l.createdAt) return;
      const wk = toISOWeek(l.createdAt);
      if (!weekMap[wk]) weekMap[wk] = { week: wk, total: 0, reponse: 0, meeting: 0, discovery: 0 };
      weekMap[wk].total++;
      if (l.reponse)     weekMap[wk].reponse++;
      if (l.meetingDone) weekMap[wk].meeting++;
      if (ACTIVE_STAGES.includes(l.stage)) weekMap[wk].discovery++;
    });
    // Trier et garder les 16 dernières semaines
    const byWeek = Object.values(weekMap)
      .sort((a, b) => a.week.localeCompare(b.week))
      .slice(-16);

    // ── NOUVEAU : Reach par mois ───────────────────────────────────────────────
    const monthMap = {};
    leads.forEach(l => {
      if (!l.createdAt) return;
      const mo = toYearMonth(l.createdAt);
      if (!monthMap[mo]) monthMap[mo] = { month: mo, total: 0, reponse: 0, meeting: 0, discovery: 0 };
      monthMap[mo].total++;
      if (l.reponse)     monthMap[mo].reponse++;
      if (l.meetingDone) monthMap[mo].meeting++;
      if (ACTIVE_STAGES.includes(l.stage)) monthMap[mo].discovery++;
    });
    const byMonth = Object.values(monthMap)
      .sort((a, b) => a.month.localeCompare(b.month))
      .slice(-12);

    return res.status(200).json({
      enabled: true, fetchedAt: new Date().toISOString(),
      total, totalReponse, totalMeeting, totalContacted, totalDiscovery,
      conversionRates, funnel, byOwner, byVerticale, bySegment, topBlockers, activeProspects,
      byWeek,    // ← NOUVEAU
      byMonth,   // ← NOUVEAU
      byUsecase, // ← NOUVEAU
    });
  } catch (err) {
    console.error('Airtable error:', err.message);
    return res.status(500).json({ error: err.message, enabled: false });
  }
};
