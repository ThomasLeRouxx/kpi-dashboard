/**
 * Vercel Serverless Function — Proxy Airtable API
 * Fichier : /api/airtable.js
 */

const maxDuration = 30;
exports.maxDuration = maxDuration;

const FUNNEL_STAGES = ['Identified', 'Researched', 'Contacted', 'Discovery Call', 'ETHcc meeting', 'Not Ready Yet', 'Not Interested'];
const ACTIVE_STAGES = ['Discovery Call', 'ETHcc meeting'];

function toStr(v) {
  if (Array.isArray(v)) return v.join(', ');
  if (v === null || v === undefined) return '';
  return String(v);
}

function toBool(v) {
  return v === true || v === 'checked';
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

    const total        = leads.length;
    const totalReponse = leads.filter(l => l.reponse).length;
    const totalMeeting = leads.filter(l => l.meetingDone).length;
    const totalContacted = leads.filter(l => l.stage !== 'Identified' && l.stage !== 'Researched').length;
    const discovery    = leads.filter(l => ACTIVE_STAGES.includes(l.stage)).length;

    const conversionRates = {
      identifiedToContacted: total > 0        ? Math.round((totalContacted / total) * 100)        : 0,
      contactedToReponse:    totalContacted > 0 ? Math.round((totalReponse / totalContacted) * 100) : 0,
      reponseToMeeting:      totalReponse > 0   ? Math.round((totalMeeting / totalReponse) * 100)   : 0,
      meetingToDiscovery:    totalMeeting > 0   ? Math.round((discovery / totalMeeting) * 100)      : 0,
    };

    const funnel = FUNNEL_STAGES.map(stage => ({
      stage,
      count: leads.filter(l => l.stage === stage).length,
    }));

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

    const vertNames = [...new Set(leads.map(l => l.verticale).filter(Boolean))];
    const byVerticale = vertNames.map(v => ({
      verticale: v,
      count:    leads.filter(l => l.verticale === v).length,
      meetings: leads.filter(l => l.verticale === v && l.meetingDone).length,
    }));

    const segNames = [...new Set(leads.map(l => l.segment).filter(Boolean))];
    const bySegment = segNames.map(s => ({
      segment:   s,
      count:     leads.filter(l => l.segment === s).length,
      meetings:  leads.filter(l => l.segment === s && l.meetingDone).length,
      discovery: leads.filter(l => l.segment === s && ACTIVE_STAGES.includes(l.stage)).length,
    }));

    const blockerMap = {};
    leads.forEach(l => {
      if (!l.blockers) return;
      l.blockers.split(',').forEach(b => {
        const key = b.trim().replace(/^"|"$/g, '');
        if (key) blockerMap[key] = (blockerMap[key] || 0) + 1;
      });
    });
    const topBlockers = Object.entries(blockerMap)
      .sort((a, b) => b[1] - a[1]).slice(0, 6)
      .map(([name, count]) => ({ name, count }));

    const activeProspects = leads
      .filter(l => ACTIVE_STAGES.includes(l.stage))
      .map(l => ({ company: l.company, stage: l.stage, owner: l.owner,
        verticale: l.verticale, tvl: l.tvl, segment: l.segment,
        recentNews: l.recentNews, nextStep: l.nextStep }));

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
    return res.status(200).json({
      enabled: true, fetchedAt: new Date().toISOString(),
      total, totalReponse, totalMeeting, totalContacted,
      conversionRates, funnel, byOwner, byVerticale, bySegment, topBlockers, activeProspects,
    });

  } catch (err) {
    console.error('Airtable error:', err.message);
    return res.status(500).json({ error: err.message, enabled: false });
  }
};
