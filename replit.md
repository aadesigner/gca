# Vehicle Data Intelligence Platform

A data intelligence platform for collecting, normalizing, and serving vehicle data from multiple online providers. It ingests listings from marketplaces, auction sites, and dealer networks — extracting VINs, pricing history, and observations — and exposes the cleaned data through a public API.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run generate` — generate a new SQL migration after schema changes
- `pnpm --filter @workspace/db run migrate` — apply all pending migrations (safe to run on every deploy)
- `pnpm --filter @workspace/db run push` — push schema changes directly, dev only (skips migration files)
- `pnpm --filter @workspace/scripts run seed-admin` — create the initial admin user. Reads `ADMIN_EMAIL` (default: admin@example.com) and `ADMIN_PASSWORD` (auto-generated if not set — printed once to stderr, store it immediately)
- Required env: `DATABASE_URL` — Postgres connection string, `SESSION_SECRET` — session signing secret

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Auth: bcryptjs + express-session + connect-pg-simple (DB-backed sessions)
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)
- Frontend: React 19 + Vite 7 + Tailwind CSS v4 + shadcn/ui + Recharts

## Where things live

- `lib/db/src/schema/` — all Drizzle ORM table definitions (one file per entity)
- `lib/api-spec/openapi.yaml` — single source of truth for all API contracts
- `lib/providers/src/` — ProviderAdapter interface + ProviderRegistry (no concrete adapters yet)
- `artifacts/api-server/src/routes/admin/` — all admin REST endpoints
- `artifacts/api-server/src/middlewares/auth.ts` — session auth middleware
- `artifacts/api-server/src/lib/audit.ts` — audit log writer
- `artifacts/admin-dashboard/src/` — React admin dashboard frontend

## Architecture decisions

- **Contract-first API**: OpenAPI spec → Orval codegen → typed React Query hooks + Zod validators. Never hand-write types the codegen produces.
- **DB-backed sessions**: `connect-pg-simple` stores sessions in the `session` table. `SESSION_SECRET` must be set.
- **Audit logging**: `writeAuditLog()` is called from every mutating admin route. All writes go to `audit_logs`.
- **Provider abstraction**: `lib/providers` defines the `ProviderAdapter` interface. Phase 2 will add concrete adapters registered via `providerRegistry`.
- **Zod integer types**: The workspace uses Zod 3.25.x. Use `type: number` (not `type: integer`) in the OpenAPI spec to avoid Orval generating `zod.int()` (a Zod v4-only method).
- **Session config**: `trust proxy: 1` is set in app.ts so secure cookies work behind the Replit proxy.

## Product

Admin dashboard at `/` with sidebar navigation. **First-time setup**: run `pnpm --filter @workspace/scripts run seed-admin` — credentials are printed once to stderr (store immediately). Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` env vars to override defaults. Sections: Dashboard (live stats), Providers (CRUD), Collectors, Jobs, Vehicles, VIN Search, Listings, API Clients, API Tokens, API Logs, Audit Logs, Raw Data, Settings.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- After schema changes in `lib/db/src/schema/`, run `pnpm run typecheck:libs` before running `pnpm --filter @workspace/api-server run typecheck` — stale lib declarations cause false "no exported member" TS errors.
- Orval (v8.23.0) with Zod 3.25.x: use `type: number` in the OpenAPI spec, not `type: integer`. The `integer` type generates `zod.int()` which only exists in Zod v4 API path.
- Do not run `pnpm dev` at the workspace root — each artifact needs workflow-provided `PORT` and `BASE_PATH`.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
