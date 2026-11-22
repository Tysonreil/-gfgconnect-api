'use strict';
// Offline tests: @azure/functions and fetch are mocked, so no network and no real keys.
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');

const handlers = {};
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === '@azure/functions') return { app: { http: (name, opts) => { handlers[name] = opts; } } };
  return origLoad.call(this, req, ...rest);
};
process.env.MOMENTUM_API_KEY = 'test-key-123';
for (const f of ['ping', 'momentum-status', 'momentum-insureds', 'momentum-policies']) require(`../src/functions/${f}.js`);
const lib = require('../src/lib/momentum');

const calls = [];
function mockFetch(rows) {
  global.fetch = async (url, opts = {}) => {
    calls.push({ url, opts });
    if (url.includes('/api/token/exchange-api-key')) {
      return { ok: true, status: 200, json: async () => ({ AccessToken: 'tok', RefreshToken: 'r', ExpiresIn: new Date(Date.now() + 864e5).toISOString() }) };
    }
    return { ok: true, status: 200, json: async () => ({ value: rows }) };
  };
}
const req = (q) => ({ query: new URLSearchParams(q) });
const ctx = { error() {}, warn() {}, log() {} };

test('ping', async () => {
  const r = await handlers.ping.handler(req(''), ctx);
  assert.equal(r.status, 200); assert.equal(r.jsonBody.ok, true);
  assert.equal(handlers.ping.authLevel, 'anonymous');
});

test('momentum endpoints require a function key', () => {
  for (const n of ['momentum-status', 'momentum-insureds', 'momentum-policies']) assert.equal(handlers[n].authLevel, 'function');
});

test('status returns no client data', async () => {
  lib._resetTokenForTests(); mockFetch([{ databaseId: 'x', commercialName: 'Secret Co' }]);
  const r = await handlers['momentum-status'].handler(req(''), ctx);
  assert.equal(r.status, 200); assert.equal(r.jsonBody.ok, true);
  assert.ok(!JSON.stringify(r.jsonBody).includes('Secret Co'));
  assert.ok(!JSON.stringify(r.jsonBody).includes('test-key-123'));
});

test('insureds: redacts sensitive fields, caps top, builds filter', async () => {
  lib._resetTokenForTests(); calls.length = 0;
  mockFetch([{ databaseId: 'a', commercialName: 'ACME', ssn: '123-45-6789', dateOfBirth: '1980-01-01', contacts: [{ name: 'x', driverLicenseNumber: 'D1' }] }]);
  const r = await handlers['momentum-insureds'].handler(req('q=O\'Brien&top=5000'), ctx);
  assert.equal(r.status, 200); assert.equal(r.jsonBody.top, 100);
  const s = JSON.stringify(r.jsonBody);
  assert.ok(!s.includes('123-45-6789') && !s.includes('1980-01-01') && !s.includes('D1'));
  const listCall = calls.find((c) => c.url.includes('InsuredDetailList'));
  assert.ok(decodeURIComponent(listCall.url).includes("o''brien"));
  assert.equal(listCall.opts.method, undefined); // GET
  assert.equal(r.headers['Cache-Control'], 'no-store');
});

test('insureds: rejects bad id', async () => {
  const r = await handlers['momentum-insureds'].handler(req('id=notaguid'), ctx);
  assert.equal(r.status, 400);
});

test('policies: excludes quotes by default and filters by insured', async () => {
  lib._resetTokenForTests(); calls.length = 0; mockFetch([]);
  const g = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
  const r = await handlers['momentum-policies'].handler(req(`insuredId=${g}&status=Active`), ctx);
  assert.equal(r.status, 200);
  const u = decodeURIComponent(calls.find((c) => c.url.includes('PolicyDetailList')).url);
  assert.ok(u.includes(`insuredDatabaseId eq ${g}`) && u.includes('isQuote eq false') && u.includes("startswith(status,'Active')"));
});

test('errors never leak the key', async () => {
  lib._resetTokenForTests();
  global.fetch = async () => ({ ok: false, status: 401, text: async () => 'apiKey=test-key-123' });
  const r = await handlers['momentum-insureds'].handler(req(''), ctx);
  assert.equal(r.status, 401);
  assert.ok(!JSON.stringify(r.jsonBody).includes('test-key-123'));
});
