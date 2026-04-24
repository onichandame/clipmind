# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

ClipMind is a **pnpm monorepo** for an AI-driven video creation desktop app. Three main packages:

- `apps/desktop` — Tauri v2 (Rust) shell + React Router v7 SPA (`ssr: false`) + Vite
- `apps/server` — Hono Node.js API server, run with `tsx`
- `packages/db` — Shared Drizzle ORM + MySQL schema and migrations

## Commands

### Root-level

```bash
pnpm dev              # full local stack: Tauri dev + server dev
pnpm dev:desktop      # frontend dev server only (Vite, no Tauri)
pnpm tauri:dev        # launch full Tauri desktop app in dev
pnpm tauri:build      # production desktop build
pnpm build:desktop    # desktop frontend build only
```

### Package-level

```bash
pnpm --filter desktop typecheck        # react-router typegen && tsc
pnpm --filter server dev               # tsx watch src/index.ts
cd packages/db && pnpm drizzle-kit generate   # generate migrations after schema edits
cd packages/db && pnpm drizzle-kit push       # dev-only force sync (no migration file)
```

**No** root `lint`, `test`, or `typecheck` scripts exist. No Turbo/Nx. No ESLint/Prettier/Biome config.

### Prerequisites for local dev

MySQL and Qdrant must be running before `pnpm dev` is useful. No `docker-compose.yml` is provided.

## Architecture

### Data flow

```
Frontend (React Router SPA)
  ↕ IPC (Tauri commands/events)
Rust shell (Tauri v2)
  ↕ reqwest / Tauri shell sidecar
Hono server (Node, tsx)
  ↕ Drizzle ORM
MySQL + Qdrant (vector search)
```

- Frontend state: `@tanstack/react-query` + React Router loaders
- AI workflows: Vercel AI SDK v6+ (`streamText`, ReAct tool loop)
- File storage: Aliyun OSS (pre-signed PUT from Rust)
- Speech recognition: Aliyun ASR (triggered by server after upload)

### Asset processing pipeline (Rust-owned, do not break)

1. **Semaphore-gated FFmpeg sidecar** separates audio (16kHz/mono/16-bit PCM) from video
2. **Async streaming upload** via `tokio_util::codec::FramedRead` → OSS pre-signed PUT (must include `Content-Length` header to prevent chunked transfer breaking the signature)
3. **Server notification** via `reqwest::Client` from Rust (never from frontend)
4. **RAII cleanup** of temp files only after upload returns 200 OK

### Vercel AI SDK / ReAct loop

- `MAX_STEPS` is 20; the tool chain (`search_assets → search_clips → manage_footage_basket → updateOutline → generateEditingPlan`) easily exceeds 10 steps with retries
- Always pair `stopWhen: [stepCountIs(MAX_STEPS), hasToolCall('generateEditingPlan')]` — `stopWhen` is OR logic
- `hasToolCall` is imported from `'ai'`, same package as `stepCountIs`
- `prepareStep` references the `MAX_STEPS` constant; do not hardcode step numbers
- LLMs output unpredictable key casing (`endtime` vs `endTime`); always use `z.preprocess` to normalize before Zod validation

### Storage: two locations for editing plans (do not confuse)

- `editingPlans` **table** in `packages/db/src/schema.ts` — actual storage written by `generateEditingPlan`
- `projects.editingPlans` **JSON column** on the `projects` table — legacy, never written to by server code

Always read/write from the table.

### Environment variables

- Server schema (source of truth): `apps/server/src/env.ts`
- Desktop client schema: `apps/desktop/app/env.ts`
- Desktop loader-side DB: `apps/desktop/app/utils/env.server.ts`
- `import 'dotenv/config'` must be the **absolute first line** of `apps/server/src/index.ts`
- Never read `process.env` or `import.meta.env` directly in business code; always go through the typed schema

### Tailwind v4 + Dark mode

- No `tailwind.config.js` — Tailwind v4 via `@tailwindcss/vite`
- Dark mode is class-driven (`.dark` on `<html>`), not media-query driven
- `@custom-variant dark (&:where(.dark, .dark *));` is declared in `app/app.css`
- All components must provide both light and dark classes; never hardcode a single-mode color
- For `prose` (typography plugin): use `prose-invert` on permanently-dark blocks, `dark:prose-invert` on theme-following blocks

## Hard Rules (Red Lines)

**EDD — evidence before editing.** When a bug appears, add probes/logs and confirm the real failure path before changing code.

**底层归底层 (layers own their responsibilities):**
- Never parse local file metadata in the frontend; Rust reads FFmpeg stderr for duration
- Never call the upload/notify webhook from the frontend; Rust's `reqwest::Client` must do it
- Never spawn FFmpeg via `std::process::Command` or `spawn_blocking`; use Tauri v2 `app.shell().sidecar()`

**IPC discipline:**
- `Semaphore(1)` guards all heavy sidecar work
- Progress events to frontend must be throttled at ≥500ms via `std::time::Instant`; never emit raw FFmpeg byte stream

**OSS upload:**
- Never `fs::read` large files into `Vec<u8>`; always stream with `FramedRead`
- Always set `Content-Length` header on pre-signed PUT requests

**Env validation:**
- `CORS_ORIGIN` from env must be split via `.transform(val => val.split(','))` before passing to CORS middleware
- Broken env must fail fast at startup

**Do not `select *` on project list queries** — `projects.uiMessages` is a large JSON blob that causes OOM.

**Do not commit `apps/desktop/src-tauri/bin/ffmpeg-*`** (sidecar binaries).

**Production runtime is `tsx`** (esbuild-based JIT transpile); never run full `tsc` compilation on the server in production — it causes OOM on complex Drizzle+Zod type graphs.

**Tauri plugin dual-registration:** any new Tauri plugin needs `Cargo.toml` dep + `lib.rs` `.plugin(init())` + `capabilities/*.json` permission grant — all three, or the frontend silently fails.

**JIT asset URL signing:** reuse the existing `ossClient.signatureUrl()` batch-lookup pattern in `apps/server/src/routes/projects.ts` when adding fields that reference assets.

## Testing Policy

**Do NOT run any tests or typechecks** (e.g., `pnpm --filter desktop typecheck`, `tsc`, unit tests). The user performs e2e testing manually to verify changes. Submit code changes directly for the user's verification.

## AI SDK Knowledge Base

Before editing any file that imports from `'ai'` or `'@ai-sdk/*'`, read the local knowledge base first:

- `docs/ai-sdk/README.md` — quick-reference for correct imports and API names
- `docs/ai-sdk/backend-patterns.md` — `streamText`, tools, `stopWhen`, `prepareStep`, `onFinish`
- `docs/ai-sdk/frontend-patterns.md` — `useChat`, typed tool parts, state names

Key gotchas captured there: `isStepCount` (not `stepCountIs`), typed tool parts (`tool-{name}` not `tool-invocation`), and `inputSchema` (not `parameters`).

## Key Files

| File | Purpose |
|------|---------|
| `apps/server/src/env.ts` | Server env schema (source of truth) |
| `apps/desktop/app/env.ts` | Desktop client env schema |
| `apps/desktop/src-tauri/src/lib.rs` | Rust shell: upload pipeline, sidecar, IPC |
| `apps/desktop/src-tauri/tauri.conf.json` | Tauri config (app ID, sidecar, capabilities) |
| `packages/db/src/schema.ts` | Drizzle schema for all tables |
| `apps/server/src/routes/chat.ts` | Vercel AI SDK ReAct loop, tool definitions |
| `apps/server/src/routes/projects.ts` | Project CRUD + JIT asset URL signing |
| `plan/ClipMind_TODO.md` | Current stage-level progress tracking |
