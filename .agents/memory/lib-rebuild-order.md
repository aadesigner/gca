---
name: Lib rebuild before artifact typecheck
description: Artifact typechecks fail with false "no exported member" errors if lib declarations are stale. Always rebuild libs first.
---

# Lib Rebuild Order

## The rule
Run `pnpm run typecheck:libs` (which runs `tsc --build`) before running any per-artifact typecheck like `pnpm --filter @workspace/api-server run typecheck`.

**Why:** TypeScript project references compile declarations to `dist/`. After adding new schema tables, the `@workspace/db` dist is stale. The api-server reads those compiled declarations — not the source — so it sees the old exports and reports false "Module '@workspace/db' has no exported member 'fooTable'" errors. The source has the export; the compiled output doesn't until you rebuild.

**How to apply:** Any time you add or remove exports from a lib package (`lib/db`, `lib/api-zod`, `lib/api-client-react`, `lib/providers`), run `pnpm run typecheck:libs` first, then check the artifact.
