# gfgconnect-api

Azure Functions v4 (Node.js 20+) back end for GFG Connect.

- **Read-only.** It only reads from Momentum/NowCerts, which stays the system of record. Nothing is ever created, changed or deleted there.
- **Stores nothing.** There is no database, cache, file or queue. The only thing kept between requests is the Momentum access token, held in memory.
- **Redacts sensitive fields.** SSN, tax ID, date of birth, driver's license, Medicare, Rx and doctor fields, personal notes, and bank or card fields are stripped from every response.
- **No caching.** Every response sends `Cache-Control: no-store`.

## Endpoints

| Route | Auth | Purpose |
|---|---|---|
| `GET /api/ping` | anonymous | Liveness check. Returns no data. |
| `GET /api/momentum/status` | function key | Checks that settings are present, Momentum sign-in works and one record can be read. Returns no client data. |
| `GET /api/momentum/insureds?id=&q=&top=&skip=` | function key | Looks up clients by id, or searches by name. |
| `GET /api/momentum/policies?insuredId=&id=&number=&status=&includeQuotes=&top=&skip=` | function key | Looks up policies. Quotes are excluded by default. |

`top` defaults to 25 and is capped at 100.

## Settings

These are already set on the Function App:

- `MOMENTUM_API_KEY`
- `ANTHROPIC_API_KEY` (not used yet)
- `TENANT_ID`
- `GRAPH_CLIENT_ID`
- `GRAPH_CLIENT_SECRET`

Optional: `MOMENTUM_BASE_URL`. It defaults to `https://api.momentumamp.com`.

## Test

`npm install && npm test` runs offline. Both fetch and `@azure/functions` are mocked.

## Verify after the first deploy

Call `/api/momentum/status`, then check that each of these filters works against the live API:

- the id filter (`databaseId eq <guid>`)
- the name search (`contains(tolower(...))`)
- `startswith(status,...)`
- `isQuote eq false`

If Momentum rejects one, the endpoint returns a 400 that includes Momentum's own error message. Adjust that filter in the matching function.
