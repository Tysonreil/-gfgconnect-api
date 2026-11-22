'use strict';
const { app } = require('@azure/functions');
const { getList, redact, paging, GUID, odataString, json, errorResponse, MomentumError } = require('../lib/momentum');

// GET /api/momentum/policies
//   ?insuredId=<insured databaseId>   policies for one client
//   ?id=<policy databaseId>           one policy
//   ?number=<policy number>           exact policy number
//   ?status=Active                    status starts with this text (Active, Renewing, Pending Cancel...)
//   ?includeQuotes=true               quotes are excluded unless asked for
//   ?top=25&skip=0                    paging (top is capped at 100)
// Read-only pass-through: Momentum stays the system of record; nothing is stored here.
app.http('momentum-policies', {
  methods: ['GET'],
  authLevel: 'function',
  route: 'momentum/policies',
  handler: async (request, context) => {
    try {
      const { top, skip } = paging(request);
      const insuredId = (request.query.get('insuredId') || '').trim();
      const id = (request.query.get('id') || '').trim();
      const number = (request.query.get('number') || '').trim();
      const status = (request.query.get('status') || '').trim();
      const includeQuotes = /^(1|true|yes)$/i.test(request.query.get('includeQuotes') || '');

      const filters = [];
      if (insuredId) {
        if (!GUID.test(insuredId)) throw new MomentumError('insuredId must be a GUID.', 400);
        filters.push(`insuredDatabaseId eq ${insuredId}`);
      }
      if (id) {
        if (!GUID.test(id)) throw new MomentumError('id must be a GUID.', 400);
        filters.push(`databaseId eq ${id}`);
      }
      if (number) {
        if (number.length > 60) throw new MomentumError('number is too long.', 400);
        filters.push(`number eq '${odataString(number)}'`);
      }
      if (status) {
        if (!/^[A-Za-z ]{2,30}$/.test(status)) throw new MomentumError('status must be plain text, e.g. Active.', 400);
        filters.push(`startswith(status,'${odataString(status)}')`);
      }
      if (!includeQuotes) filters.push('isQuote eq false');

      const rows = await getList('PolicyDetailList', {
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
