# Bookmark Captain

Every post you saved, on every platform, in one inbox — summarised, linked across platforms,
and resurfaced so you actually use it.

**Using the app?** Read the [User Guide](docs/USER_GUIDE.md): setup, connecting platforms,
the inbox, and troubleshooting.

## What works today

- **Inbox** — views (Inbox, Snoozed, Done, Archived, All), search, platform filter,
  mark done, snooze, archive, delete, infinite scroll. Updates live, without reloading.
- **Save a link** — tracking parameters (`utm_*`, `fbclid`, `si`, …) are stripped, and the same
  page saved twice (or from another platform) is detected instead of duplicated.
- **Import `bookmarks.html`** — exports from Chrome, Firefox, Safari or Edge, with folder paths.
- **Chrome extension** — imports all browser bookmarks, then syncs every add, edit, move and
  delete as it happens. Changes made offline are queued and retried.
- **Platforms** — X bookmarks, Reddit saves, Instagram saves and YouTube Watch later: imported
  once, then new saves (and unsaves) sync within seconds, plus a check every 30–60 minutes.
  Any other site can be taught from its saved page ("Sync this list", experimental).
- **Accounts** — Google sign-in, plus an email-only sign-in for local development.

## Repository layout

```
apps/
  api/        Express 5 API — auth, API tokens, bookmarks, live events (SSE)
  web/        Next.js 16 web app (App Router, Tailwind CSS 4, TanStack Query)
  extension/  Chrome extension (Manifest V3), bundled with esbuild
packages/
  db/         Drizzle ORM schema, Postgres client (Neon-ready), SQL migrations
  shared/     Types, zod schemas, URL normaliser; `@bc/shared/constants` is dependency-free
e2e/          Playwright end-to-end tests (API + web + real Chromium with the extension)
```

Tooling: pnpm workspaces, Turborepo, TypeScript (strict), ESLint (type-aware), Prettier,
Vitest + Supertest, Playwright, GitHub Actions CI.

## Prerequisites

- Node.js 24 (see `.nvmrc`) and pnpm 10 (`corepack enable`)
- A Neon project with three branches: `production`, `dev` (local development) and
  `test` (wiped by the test suites). Docker is optional (`pnpm db:up`) for working offline.

## Getting started

```bash
pnpm install
cp .env.example .env          # fill in the Neon connection strings (see "Using Neon")
pnpm db:migrate               # apply migrations to DATABASE_URL
pnpm dev                      # API on :4000, web on :3000, extension rebuilt on change
```

Open http://localhost:3000 and use **Development sign-in** (any email) — no Google setup needed
locally.

### Install the Chrome extension (development)

1. `pnpm --filter @bc/extension build` (or keep `pnpm dev` running).
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and choose
   `apps/extension/dist`.
3. Click the extension icon → **Connect account**, then **Connect extension** on the page that
   opens. Your bookmarks are imported and stay in sync from then on.

The extension is built for the URLs in `.env` (`NEXT_PUBLIC_API_URL`, `WEB_URL`); override with
`EXTENSION_API_URL` / `EXTENSION_WEB_URL` for other environments.

## Common commands

| Command            | What it does                                                     |
| ------------------ | ---------------------------------------------------------------- |
| `pnpm dev`         | Run every app in watch mode                                      |
| `pnpm test`        | Unit + integration tests (uses `TEST_DATABASE_URL`)              |
| `pnpm test:e2e`    | End-to-end tests on ports 3100/4100 against `TEST_DATABASE_URL`  |
| `pnpm lint`        | ESLint with type-aware rules                                     |
| `pnpm typecheck`   | `tsc` in every package                                           |
| `pnpm format`      | Prettier                                                         |
| `pnpm build`       | Production builds (API bundle, web app, extension)               |
| `pnpm db:generate` | Create a SQL migration after editing `packages/db/src/schema.ts` |
| `pnpm db:migrate`  | Apply pending migrations                                         |
| `pnpm db:studio`   | Browse the database with Drizzle Studio                          |

The first `pnpm test:e2e` needs a browser: `pnpm --filter @bc/e2e exec playwright install chromium`.
The e2e suite builds its own copies of the web app (`apps/web/.next-e2e`) and extension
(`e2e/.extension`), so it never disturbs `pnpm dev` or your dev data.

## API overview

| Method & path                | Auth             | Purpose                                           |
| ---------------------------- | ---------------- | ------------------------------------------------- |
| `GET /bookmarks`             | session or token | List with `view`, `platform`, `q`, cursor paging  |
| `POST /bookmarks`            | session or token | Save one link (returns the existing one if saved) |
| `POST /bookmarks/ingest`     | session or token | Idempotent bulk upsert (≤ 500 items per request)  |
| `POST /bookmarks/remove`     | session or token | Mirror deletions made at the source               |
| `PATCH /bookmarks/:id`       | session or token | Change status / snooze                            |
| `DELETE /bookmarks/:id`      | session or token | Delete                                            |
| `GET /events`                | session or token | Server-sent events: `bookmarks.changed`           |
| `GET/POST /api-tokens`       | session only     | List / create API tokens (e.g. for the extension) |
| `DELETE /api-tokens/:id`     | session only     | Revoke a token                                    |
| `DELETE /api-tokens/current` | token only       | A client revokes its own token (disconnect)       |
| `/auth/*`, `GET /me`         | —                | Sign-in, sign-out, current user                   |

Errors always have the shape `{ "error": { "code", "message", "details?" } }`.

## Using Neon

1. Create a project at https://console.neon.tech, then create `dev` and `test` branches
   from `production` (or `neonctl branches create --name dev`).
2. For the `dev` branch, copy the **pooled** connection string into `DATABASE_URL` and the
   **direct** one into `DATABASE_URL_UNPOOLED`. Migrations use the direct connection.
3. Copy the `test` branch's direct connection string into `TEST_DATABASE_URL`.
4. Use `sslmode=verify-full` in every URL.
5. `pnpm db:migrate`

The `production` branch is only touched by deployments (`pnpm db:migrate` with production env vars).

Point your host's health check at `/healthz` (process liveness, no database access), not
`/readyz` — frequent readiness probes would keep the Neon compute from scaling to zero.

## Google sign-in

1. Google Cloud Console → APIs & Services → Credentials → **Create OAuth client ID** → Web application.
2. Authorized redirect URI: `{API_URL}/auth/google/callback` (locally `http://localhost:4000/auth/google/callback`).
3. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

## Security model (summary)

- Opaque server-side sessions. The browser holds a random token in an `HttpOnly`, `SameSite=Lax`
  cookie; the database stores only its SHA-256 hash. Sliding 30-day expiry.
- API tokens (`bct_…`) for the extension are also stored hashed, expire after a year, can only be
  created from a browser session, and can be revoked from Settings → Connected devices.
- The extension receives its token via `window.postMessage` on the web app's own connect page;
  the background worker only accepts it from that exact origin and path.
- Google OAuth uses the Authorization Code flow with PKCE and a `state` check.
- CSRF: `SameSite=Lax` plus an `Origin` allow-list on every cookie-authenticated state change.
- Helmet security headers, strict CORS (web origin only), per-IP rate limits, body size limits.
- Configuration is validated at startup; the API refuses to boot with invalid or unsafe settings
  (for example, dev sign-in enabled in production).

## Production notes

- In production with `app.example.com` and `api.example.com`, set `COOKIE_DOMAIN=example.com`
  so the Next.js server can read the session cookie.
- Set `TRUST_PROXY` to the number of proxies in front of the API so client IPs and rate limits are correct.
- Rate limiting and live events are in-memory: correct for one API instance. Before running
  several replicas, move rate limits to a shared store and fan events out via Redis or Postgres
  `LISTEN/NOTIFY`.
- API: `pnpm --filter @bc/api build && pnpm --filter @bc/api start` (bundled to `apps/api/dist`).
