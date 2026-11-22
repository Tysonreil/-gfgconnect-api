'use strict';
const { app } = require('@azure/functions');
const { BASE_URL, getAccessToken, getList, json, hide } = require('../lib/momentum');

// GET /api/momentum/status — confirms the Function App can sign in to Momentum and read one record.
// Returns only yes/no checks and timings: no client data, no key, no token.
app.http('momentum-status', {
  methods: ['GET'],
  authLevel: 'function',
  route: 'momentum/status',
  handler: async (request, context) => {
    const settings = {
      MOMENTUM_API_KEY: Boolean(process.env.MOMENTUM_API_KEY),
      ANTHROPIC_API_KEY: Boolean(process.env.ANTHROPIC_API_KEY),
      TENANT_ID: Boolean(process.env.TENANT_ID),
      GRAPH_CLIENT_ID: Boolean(process.env.GRAPH_CLIENT_ID),
      GRAPH_CLIENT_SECRET: Boolean(process.env.GRAPH_CLIENT_SECRET)
    };
    const result = { ok: false, api: BASE_URL, settings, signIn: null, read: null };
    try {
      let t = Date.now();
      await getAccessToken(false);
      result.signIn = { ok: true, ms: Date.now() - t };
      t = Date.now();
      const rows = await getList('InsuredDetailList', { $top: 1, $skip: 0, $orderby: 'changeDate desc' });
      result.read = { ok: true, ms: Date.now() - t, recordsReturned: rows.length };
      result.ok = true;
      return json(200, result);
    } catch (err) {
      context.warn(`Momentum status check failed: ${hide(err.message)}`);
      if (!result.signIn) result.signIn = { ok: false, error: err.message };
      else result.read = { ok: false, error: err.message };
      return json(err.status === 401 ? 401 : 502, result);
    }
  }
});
