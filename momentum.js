'use strict';
/**
 * Read-only Momentum (NowCerts) client for GFG Connect.
 *
 * Rules this module enforces:
 *  - GET requests only (plus the token exchange). Nothing is ever created, changed or deleted in Momentum.
 *  - Nothing is written to disk, a database, or any cache outside this process. The only thing held
 *    in memory between requests is the Momentum access token.
 *  - The API key and tokens are never logged or returned to callers.
 *  - Sensitive personal fields are stripped from every record before it leaves the function.
 */

const BASE_URL = (process.env.MOMENTUM_BASE_URL || 'https://api.momentumamp.com').replace(/\/+$/, '');
const MAX_TOP = 100;

// In-memory token only (per function instance). Never persisted.
let token = null; // { access, expiresAt (ms) }

class MomentumError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'MomentumError';
    this.status = status || 502;
  }
}

function hide(text) {
  return String(text || '')
    .replace(/apiKey=[^"&\s]+/gi, 'apiKey=[hidden]')
    .replace(/"(access|refresh)token"\s*:\s*"[^"]+"/gi, '"$1Token":"[hidden]"')
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/g, 'Bearer [hidden]');
}

async function exchangeKey() {
  const key = (process.env.MOMENTUM_API_KEY || '').trim();
  if (!key) throw new MomentumError('MOMENTUM_API_KEY is not set on the Function App.', 500);
  const res = await fetch(`${BASE_URL}/api/token/exchange-api-key?apiKey=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { Accept: 'application/json' }
  });
  if (!res.ok) {
    const status = res.status === 401 ? 401 : 502;
    throw new MomentumError(
      res.status === 401
        ? 'Momentum rejected the API key (401). Generate a new key in Momentum and update MOMENTUM_API_KEY.'
        : `Momentum sign-in failed (HTTP ${res.status}).`,
      status
    );
  }
  const body = await res.json();
  if (!body || !body.AccessToken) throw new MomentumError('Momentum sign-in returned no access token.');
  // ExpiresIn is an absolute timestamp in Momentum's API, not a number of seconds.
  let expiresAt = Date.parse(body.ExpiresIn);
  if (Number.isNaN(expiresAt)) expiresAt = Date.now() + 60 * 60 * 1000;
  token = { access: String(body.AccessToken), expiresAt };
  return token.access;
}

async function getAccessToken(forceNew) {
  if (!forceNew && token && token.expiresAt - Date.now() > 10 * 60 * 1000) return token.access;
  return exchangeKey();
}

function buildQuery(params) {
  const parts = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.join('&');
}

/** GET /api/<list>?<odata>. Retries once on 401 (new token) and up to twice on 429/503. */
async function getList(list, odata) {
  if (!/^[A-Za-z]+$/.test(list)) throw new MomentumError('Invalid list name.', 400);
  const url = `${BASE_URL}/api/${list}?${buildQuery(odata)}`;
  let access = await getAccessToken(false);
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${access}`, Accept: 'application/json' } });
    if (res.ok) {
      const body = await res.json();
      if (Array.isArray(body)) return body;
      if (body && Array.isArray(body.value)) return body.value;
      if (body && Array.isArray(body.data)) return body.data;
      return [];
    }
    if (res.status === 401 && attempt === 1) { access = await getAccessToken(true); continue; }
    if ((res.status === 429 || res.status === 503) && attempt < 3) {
      await new Promise((r) => setTimeout(r, 2000 * attempt));
      continue;
    }
    let detail = '';
    try { detail = hide((await res.text()).replace(/\s+/g, ' ').slice(0, 200)); } catch (_) { /* ignore */ }
    throw new MomentumError(`Momentum ${list} request failed (HTTP ${res.status}). ${detail}`.trim(),
      res.status === 400 ? 400 : 502);
  }
  throw new MomentumError(`Momentum ${list} request failed after retries.`);
}

// Field names that must never leave the function (matched case-insensitively, anywhere in the name).
const SENSITIVE = /(ssn|socialsecurity|taxid|fein|dateofbirth|birthdate|^dob$|driverlicen|licensenumber|medicare|hicn|drinformation|rxinformation|personnotes|parta|partb|bankaccount|routingnumber|accountnumber|cardnumber|creditcard|password|secret)/i;

/** Returns a copy of the record with sensitive fields removed (recursively for nested objects/arrays). */
function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SENSITIVE.test(k)) continue;
      out[k] = redact(v);
    }
    return out;
  }
  return value;
}

/** Parses $top/$skip from the request, capped so callers can't pull the whole book in one call. */
function paging(request) {
  const top = Math.min(Math.max(parseInt(request.query.get('top') || '25', 10) || 25, 1), MAX_TOP);
  const skip = Math.max(parseInt(request.query.get('skip') || '0', 10) || 0, 0);
  return { top, skip };
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Escapes a value for use inside an OData single-quoted string literal. */
function odataString(s) {
  return String(s).replace(/'/g, "''");
}

function json(status, body) {
  return {
    status,
    jsonBody: body,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  };
}

function errorResponse(context, err) {
  const status = err instanceof MomentumError ? err.status : 500;
  context.error(`Request failed: ${hide(err && err.message)}`);
  return json(status, { ok: false, error: err instanceof MomentumError ? err.message : 'Internal error.' });
}

module.exports = {
  BASE_URL, MAX_TOP, MomentumError, getAccessToken, getList, redact, paging, GUID, odataString, json, errorResponse, hide,
  _resetTokenForTests: () => { token = null; }
};
