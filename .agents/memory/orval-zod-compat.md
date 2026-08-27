---
name: Orval Zod v3 compat
description: Orval v8 generates Zod v4 API calls (zod.int(), zod.email()) when given integer/email types — breaks Zod 3.25.x.
---

# Orval v8 + Zod 3.25.x Compatibility

## The rule
In `lib/api-spec/openapi.yaml`, never use `type: integer` or `format: email`. Use `type: number` and omit the email format entirely.

**Why:** Orval v8.23.0 maps `type: integer` → `zod.int()` and `format: email` → `zod.email()`. Both are Zod v4-only APIs that don't exist in Zod 3.25.x. Codegen silently succeeds but the generated file fails at runtime with "zod.int is not a function".

**How to apply:** Any time you add a new field to `openapi.yaml`:
- Replace `type: integer` with `type: number`
- Remove `format: email` from string fields
- After editing the spec, run `pnpm --filter @workspace/api-spec run codegen` and check that `lib/api-zod/src/generated/api.ts` doesn't contain `zod.int(` or `zod.email(`.
