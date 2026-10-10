# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Bookmark Captain collects saved posts from every platform (browser bookmarks, X, Reddit, Instagram, YouTube Watch later, plus any site taught with "Sync this list"; LinkedIn/GitHub planned) into one inbox. How to use it (setup, connecting platforms, troubleshooting) is in `docs/USER_GUIDE.md` — keep it current when user-visible behaviour changes. Roadmap and current status live outside the repo in `~/.claude/plans/i-want-to-make-mighty-castle.md` — its **Status** section overrides the original stack (Supabase was replaced by Express + Neon).

## Commands

All commands run from the repo root (pnpm workspaces + Turborepo).

```bash
pnpm dev                 # API :4000, web :3000, extension rebuilt on change
pnpm exec turbo run dev --filter=@bc/api --filter=@bc/web   # without the extension watcher
pnpm test                # unit + integration (API tests hit TEST_DATABASE_URL)
pnpm test:e2e            # Playwright: own servers on :4100/:3100 + Chromium with the extension
pnpm lint | typecheck | format | format:check | build
pnpm db:generate         # after editing packages/db/src/schema.ts — commit the SQL it creates
pnpm db:migrate          # applies migrations to DATABASE_URL_UNPOOLED ?? DATABASE_URL
pnpm --filter @bc/extension build   # → apps/extension/dist (load unpacked in chrome://extensions)
pnpm --filter @bc/api ai status | search "<query>"   # AI progress / try search by meaning (dev DB, read-only)
```

Single tests:

```bash
pnpm --filter @bc/api exec vitest run test/bookmarks.test.ts -t "paginates"
pnpm --filter @bc/shared exec vitest run src/url.test.ts
pnpm --filter @bc/e2e exec playwright test tests/web.spec.ts -g "import"
```

CI (`.github/workflows/ci.yml`) runs format → lint → typecheck → **schema/migration drift check** (`db:generate` must produce no diff) → test → build, then the e2e job.

## Environment and databases

- One root `.env` (see `.env.example`) is loaded by every package in its own way: API dev via `tsx --env-file-if-exists`, web via `loadEnvConfig(..., forceReload=true)` in `next.config.ts` (without `forceReload` Next's cache ignores it), vitest/e2e/extension build via `process.loadEnvFile`.
- Postgres is **Neon** (project "Bookmark Captain"): branch `dev` → `DATABASE_URL` (pooled) + `DATABASE_URL_UNPOOLED` (direct, for migrations); branch `test` → `TEST_DATABASE_URL`, which the API tests and e2e suite **truncate**. Test harnesses refuse to run if it equals the dev URL. Use `sslmode=verify-full`. Docker (`pnpm db:up`) is only an offline fallback.
- Turborepo runs in strict env mode: a new env var needed by `build`/`test` tasks must be declared in `turbo.json`. Before changing Turborepo config, read the docs bundled in the installed `turbo` package (see `AGENTS.md`).

## Architecture

```
apps/api        Express 5 API          apps/web   Next.js 16 (App Router, TanStack Query, Tailwind 4)
apps/extension  Chrome MV3 (esbuild)   e2e/       Playwright suite
packages/shared zod schemas = API contract, URL normaliser    packages/db  Drizzle schema, client, migrations
```

**Internal packages ship TypeScript source, not builds.** The API bundles them with tsup (`noExternal: [/^@bc\//]`), the web app uses `transpilePackages`. Consequently `@bc/db`/`@bc/shared` list `drizzle-orm`, `pg`, `zod` as _peer_ deps and each app declares them itself.

**`@bc/shared`** — zod schemas are the single contract between API, web and extension. Dates cross the wire as ISO strings and are transformed to `Date` by the schemas (`isoDate`). `@bc/shared/constants` is deliberately zod-free: the extension must import runtime values only from there (type imports from `@bc/shared` are fine), otherwise zod gets bundled (~450 KB vs ~7 KB). `@bc/shared/logos` (also zod-free) holds the platform logos as SVG path data, drawn by both the web app (`components/ui/platform-logo.tsx`) and the extension popup.

**`@bc/db`** — Drizzle with `casing: 'snake_case'` (must match in `client.ts` and `drizzle.config.ts`). Postgres enums are generated from shared constants (`PLATFORMS`, `BOOKMARK_STATUSES`). Give unique constraints explicit names — Drizzle otherwise emits camelCase names. The migrator is a separate subpath (`@bc/db/migrator`) because it resolves the migrations folder from `import.meta.url`, which breaks inside the bundled API. Postgres needs the pgvector `vector` extension (migration 0003 creates it); drizzle-kit never emits `CREATE EXTENSION`, so such lines are added to the generated SQL by hand.

**API (`apps/api`)** — `server.ts` holds only process concerns (env, pool, graceful shutdown). `context.ts` wires plain factory-function services (`createXService(db, …)`) into an `AppContext`; `app.ts` builds middleware + one router per `src/modules/*`. Handlers throw `HttpError` or let `ZodError` propagate (Express 5 forwards async errors); `middleware/error-handler.ts` maps everything to `{ error: { code, message, details? } }` with codes from `ERROR_CODES` in shared. Log with `req.log` (pino), not `console`.

- **Auth**: `requireAuth(ctx, { methods })` accepts a bearer API token (`bct_…`, used by the extension) or the session cookie. Token management routes are session-only so a token can't mint tokens; `DELETE /api-tokens/current` lets a token revoke itself. Sessions and tokens are stored only as SHA-256 hashes. `originCheck` is the CSRF guard for cookie requests and skips bearer requests. Dev email login exists only when `AUTH_DEV_LOGIN=true` (env validation rejects it in production).
- **Bookmarks**: `ingest` is an idempotent upsert keyed on `(user_id, platform, external_id)`; `externalId` defaults to the canonical URL (browser/manual items). Re-ingest updates content but never `status`/`savedAt`, and `setWhere` skips unchanged rows. Listing is keyset-paginated on `(saved_at, id)` with an opaque cursor; `GET /bookmarks/counts` counts every view with the same `viewCondition`. **View semantics (inbox/snoozed/done/archived) are implemented in `bookmark.service.ts` and mirrored in `apps/web/src/lib/bookmark-view.ts` for optimistic updates — change both together.**
- **Live updates**: services publish to an in-process event bus → `GET /events` (SSE) → web `useLiveBookmarks` invalidates TanStack queries (debounced). Event bus and rate limiter are in-memory, i.e. single-instance only.
- **AI enrichment** (`modules/ai`, off unless a provider is configured — `providers.ts` maps `AI_PROVIDER` = `anthropic` | `groq` | `openai-compatible`, or a bare `ANTHROPIC_API_KEY`, to an `Enricher`; `loadEnv` validates each provider's required vars). `enricher.ts` holds the shared contract, prompt, output schema and `parseEnrichment`; `claude-enricher.ts` uses the Anthropic SDK, `openai-compatible-enricher.ts` uses plain `fetch` with strict `json_schema` (clips input to fit free-tier TPM limits). The queue is the `bookmarks` table itself (`enrichment_status`/`enrichment_retry_at`); `ingest` re-queues a row only when url/title/text change. `enrichment.worker.ts` (started in `server.ts`) wakes on ingest events (`events.subscribeAll`) and on due retries — it never polls while idle, so Neon can suspend. Rows are claimed with `FOR UPDATE SKIP LOCKED` plus a lease (`enrichment_retry_at`); results are saved only while that lease is still held, so content edited mid-call is re-enriched rather than overwritten. `AiError.kind` decides retry policy: `item` (backoff, counts toward the attempt limit), `refused` (fail now), `service` (pause everything, don't count). Claude output comes from structured outputs (`enricher.ts`); embeddings (Voyage, optional) go in the separate `bookmark_embeddings` table so listings don't load vectors, and are redone when `enriched_at` moves past `source_enriched_at` or the model changes. The DTO's `ai` is `null` when AI is off (unless a row was already enriched). Summaries and embeddings are configured independently (`ConfiguredAi`: either may be null). **Search by meaning** (`GET /bookmarks/search`, `search.service.ts`) needs only the embedder: it embeds the query (`input_type: query`, LRU-cached per process), ranks `bookmark_embeddings` by cosine distance under the same `viewCondition` the list uses, can exclude `wordMatchCondition` hits (the web does, showing them as a "Related by meaning" section), and applies a floor + relative cut-off tuned on voyage-4-lite. Its results live under the `['bookmarks', 'meaning']` query key and get the same optimistic updates as lists. Tests pass fake providers via `harness.createAppWithContext(env, { enricher, embedder })`.

**Web (`apps/web`)** — pages under `src/app/(app)/` share a layout that checks the session server-side. Server components call the API through `lib/api/server.ts` (server-only, forwards the session cookie); client code uses `lib/api/client.ts` (`credentials: 'include'`, throws `ApiError`). Mutations with optimistic cache updates live in `hooks/use-bookmark-mutations.ts`; a 401 anywhere redirects to `/login` (`app/providers.tsx`). The inbox's view and source filter live in the URL (`/inbox?view=done&source=x`, `lib/inbox-url.ts`), read by both the sidebar (`components/app-shell/navigation.tsx`) and `InboxView`. Triage actions go through `hooks/use-triage.ts`, which confirms them with an Undo toast (`components/ui/toaster.tsx`). Parts of the shell hydrate in separate Suspense boundaries, so shared query data rendered there is gated by `useHydrated()` to keep the first client render equal to the server HTML. Next 16 specifics: async `cookies()`/`searchParams`, and `typecheck` runs `next typegen` first.

**Extension (`apps/extension`)** — all Chrome listeners are registered at the top level of `background/index.ts` (MV3 requirement); logic is in `background/sync.ts`. Changes go through a persistent **outbox** in `chrome.storage.local`: `enqueue` merges into the last op, so after sending the head op `acknowledge` slices off only the sent count (items merged mid-flight must survive). `storage.updateState` serialises read-modify-write. `urlById` (bookmark id → URL) exists because `onChanged` doesn't report the old URL and a URL bookmarked in two folders must not be removed server-side. Connecting: the web page `/extension/connect` mints a token and `postMessage`s it → `content/bridge.ts` → background, which only accepts `connect` from that exact origin/path. `scripts/build.ts` bakes API/web URLs into the bundle (`EXTENSION_API_URL`/`EXTENSION_WEB_URL` override), generates the manifest and draws the icons in code (no binary assets).

## Testing notes

- API integration tests use a real Postgres; files run serially (`fileParallelism: false`). Use `test/harness.ts`: `harness.reset()` truncates `users` (everything cascades), create a fresh app per test so rate-limit counters reset, and `signIn` / `createApiToken` helpers give authenticated agents.
- The e2e suite builds its own web app into `apps/web/.next-e2e` (`NEXT_DIST_DIR`) and extension into `e2e/.extension` (`EXTENSION_OUT_DIR`), so it never disturbs `pnpm dev`. Ports 3100/4100 must be free. This machine has ~8 GB RAM: stop `pnpm dev` before `pnpm test:e2e`, or the Next.js build can run out of memory.

## Conventions and pitfalls

- TypeScript is pinned to 6.x: typescript-eslint doesn't support TS 7 yet.
- ESLint is type-aware (`recommendedTypeChecked` + stylistic); type imports use inline `type` specifiers; `||` is allowed for string fallbacks (empty env vars).
- Development happens on Windows: stopping a backgrounded `pnpm dev` can leave orphan `node` processes holding ports 3000/4000 — check their command line contains `bookmark-captain` before killing them. When editing files from PowerShell 5.1, avoid `Get-Content`/`Set-Content` (they corrupt UTF-8 and add a BOM); use `[IO.File]::ReadAllText`/`WriteAllText` or the file tools.
