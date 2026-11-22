'use strict';
const { app } = require('@azure/functions');

// GET /api/ping — liveness check. Touches nothing outside the Function App and returns no data.
app.http('ping', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'ping',
  handler: async () => ({
    status: 200,
    headers: { 'Cache-Control': 'no-store' },
    jsonBody: { ok: true, service: 'gfgconnect-api', time: new Date().toISOString() }
  })
});
