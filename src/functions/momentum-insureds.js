'use strict';
const { app } = require('@azure/functions');
const { getList, redact, paging, GUID, odataString, json, errorResponse, MomentumError } = require('../lib/momentum');

// GET /api/momentum/insureds
//   ?id=<insured databaseId>     one client
//   ?q=<name text>               name search (commercial name, first or last name)
//   ?top=25&skip=0               paging (top is capped at 100)
// Read-only pass-through: Momentum stays the system of record; nothing is stored here.
app.http('momentum-insureds', {
  methods: ['GET'],
  authLevel: 'function',
  route: 'momentum/insureds',
  handler: async (request, context) => {
    try {
      const { top, skip } = paging(request);
      const id = (request.query.get('id') || '').trim();
      const q = (request.query.get('q') || '').trim();

      const filters = [];
      if (id) {
        if (!GUID.test(id)) throw new MomentumError('id must be a Momentum insured databaseId (GUID).', 400);
        filters.push(`databaseId eq ${id}`);
      }
      if (q) {
        if (q.length < 2 || q.length > 80) throw new MomentumError('q must be 2-80 characters.', 400);
        const s = odataString(q.toLowerCase());
        filters.push(`(contains(tolower(commercialName),'${s}') or contains(tolower(lastName),'${s}') or contains(tolower(firstName),'${s}'))`);
      }

      const rows = await getList('InsuredDetailList', {
        $top: top,
        $skip: skip,
        $orderby: 'changeDate desc',
        $filter: filters.join(' and ') || undefined
      });
      return json(200, { ok: true, top, skip, count: rows.length, items: rows.map(redact) });
    } catch (err) {
      return errorResponse(context, err);
    }
  }
});
