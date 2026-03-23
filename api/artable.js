/**
 * Vercel Serverless Function — Proxy Airtable API
 * Fichier : /api/airtable.js
 *
 * Variables d'environnement Vercel :
 *   AIRTABLE_API_KEY   → Personal Access Token (pat...)
 *   AIRTABLE_BASE_ID   → ID de la base (appXXXXXX)
 *   AIRTABLE_TABLE_ID  → ID ou nom de la table (tblXXXXXX ou "Leads")
 */

const maxDuration = 30;
exports.maxDuration = maxDuration;

const FUNNEL_STAGES = ['Identified', 'Researched', 'Contacted', 'Discovery Call', 'ETHcc meeting', 'Not Ready Yet', 'Not Interested'];
const ACTIVE_STAGES = ['Discovery Call', 'ETHcc meeting'];

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
    // Fetch toutes les pages Airtable (max 100/page)
    let allRecords = [];
    let offset = null;

    do {
      const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableId)}`);
      url.searchParams.set('pageSize', '100');
      if (offset) url.searchParams.set('offset', offset);

      const response = await fetch(url.toString(), {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(`Airtable error ${response.status}: ${err.error?.message || JSON.stringify(err)}`);
      }

      const data = await response.json();
      allRecords = [...allRecords, ...data.records];
      offset = data.offset || null;
    } while (offset);

    // Parser les champs utiles
    const leads = allRecords.map(r => ({
      id:          r.id,
      name:        r.fields['Lead Name']   || '',
      company:     r.fields['Company / Org'] || '',
      website:     r.fields['Website']     || '',
      twitter:     r.fields['X/Twitter']   || '',
      owner:       r.fields['Lead']        || '',
      verticale:   r.fields['Verticale']   || '',
      usecase:     r.fields['Usecase']     || '',
      reponse:     r.fields['Réponse']     === 'checked' || r.fields['Réponse'] === true,
      meetingDone: r.fields['Meeting done'] === 'checked' || r.fields['Meeting done'] === true,
      stage:       r.fields['Stage']       || '',
      tvl:         r.fields['TVL']         || '',
      segment:     r.fields['Lead Segment'] || '',
      recentNews:  r.fields['Recent News'] || '',
      blockers:    r.fields['Blockers']    || '',
      feedback:    r.fields['Feedback']    || '',
      nextStep:    r.fields['Next Step']   || '',
    }));

    // ── Calculs métriques ─────────────────────────────────────────────────────

    const total = leads.length;
    const totalReponse   = leads.filter(l => l.reponse).length;
    const totalMeeting   = leads.filter(l => l.meetingDone).length;
    const totalContacted = leads.filter(l => l.stage !== 'Identified' && l.stage !== 'Researched').length;

    // Funnel par stage
    const funnel = FUNNEL_STAGES.map(stage => ({
      stage,
      count: leads.filter(l => l.stage === stage).length,
    }));

    // Taux de conversion entre stages
    const contacted = leads.filter(l => !['Identified','Researched'].includes(l.stage)).length;
    const discovery = leads.filter(l => ACTIVE_STAGES.includes(l.stage)).length;

    const conversionRates = {
      identifiedToContacted: contacted > 0 ? Math.round((contacted / total) * 100) : 0,
      contactedToReponse:    contacted > 0 ? Math.round((totalReponse / contacted) * 100) : 0,
      reponseToMeeting:      totalReponse > 0 ? Math.round((totalMeeting / totalReponse) * 100) : 0,
      meetingToDiscovery:    totalMeeting > 0 ? Math.round((discovery / totalMeeting) * 100) : 0,
    };

    // Par commercial
    const owners = [...new Set(leads.map(l => l.owner).filter(Boolean))];
    const byOwner = owners.map(owner => {
      const ownerLeads = leads.filter(l => l.owner === owner);
      const ownerRep   = ownerLeads.filter(l => l.reponse).length;
      const ownerMeet  = ownerLeads.filter(l => l.meetingDone).length;
      const ownerDisc  = ownerLeads.filter(l => ACTIVE_STAGES.includes(l.stage)).length;
      return {
        owner,
        total:      ownerLeads.length,
        reponse:    ownerRep,
        meeting:    ownerMeet,
        discovery:  ownerDisc,
        tauxRep:    ownerLeads.length > 0 ? Math.round((ownerRep / ownerLeads.length) * 100) : 0,
        tauxMeet:   ownerLeads.length > 0 ? Math.round((ownerMeet / ownerLeads.length) * 100) : 0,
        stageBreak: FUNNEL_STAGES.reduce((acc, s) => {
          acc[s] = ownerLeads.filter(l => l.stage === s).length;
          return acc;
        }, {}),
      };
    });

    // Par verticale
    const verticales = [...new Set(leads.map(l => l.verticale).filter(Boolean))];
    const byVerticale = verticales.map(v => ({
      verticale: v,
      count:    leads.filter(l => l.verticale === v).length,
      meetings: leads.filter(l => l.verticale === v && l.meetingDone).length,
    }));

    // Par segment
    const segments = [...new Set(leads.map(l => l.segment).filter(Boolean))];
    const bySegment = segments.map(s => ({
      segment:   s,
      count:     leads.filter(l => l.segment === s).length,
      meetings:  leads.filter(l => l.segment === s && l.meetingDone).length,
      discovery: leads.filter(l => l.segment === s && ACTIVE_STAGES.includes(l.stage)).length,
    }));

    // Blockers fréquents
    const blockerMap = {};
    leads.forEach(l => {
      if (!l.blockers) return;
      l.blockers.split(',').forEach(b => {
        const key = b.trim().replace(/^"|"$/g, '');
        if (key) blockerMap[key] = (blockerMap[key] || 0) + 1;
      });
    });
    const topBlockers = Object.entries(blockerMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, count]) => ({ name, count }));

    // Top prospects actifs
    const activeProspects = leads
      .filter(l => ACTIVE_STAGES.includes(l.stage))
      .map(l => ({
        company:    l.company,
        stage:      l.stage,
        owner:      l.owner,
        verticale:  l.verticale,
        tvl:        l.tvl,
        segment:    l.segment,
        recentNews: l.recentNews.slice(0, 200), // tronqué pour perf
        nextStep:   l.nextStep,
      }));

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate'); // cache 5min
    return res.status(200).json({
      enabled: true,
      fetchedAt: new Date().toISOString(),
      total,
      totalReponse,
      totalMeeting,
      totalContacted,
      conversionRates,
      funnel,
      byOwner,
      byVerticale,
      bySegment,
      topBlockers,
      activeProspects,
    });

  } catch (err) {
    console.error('Airtable error:', err);
    return res.status(500).json({ error: err.message, enabled: false });
  }
};
