# ClipMind Agent Guide

This file is a short, verified guide for AI coding agents. Keep it factual and update it when the repository changes.

## Current Facts

- This is a `pnpm` monorepo. Root package: `clipmind-workspace`.
- Package manager is pinned in `package.json`: `pnpm@10.33.0`.
- `apps/desktop` is the Tauri v2 desktop app with React Router v7 SPA mode (`ssr: false`) and Vite.
- `apps/server` is a Hono API server run with `tsx`.
- `packages/db` contains the shared Drizzle schema, client, and migrations.
- Tauri config is `apps/desktop/src-tauri/tauri.conf.json`.
- Tauri app identifier is `com.clipmind.app`.
- Tauri dev URL is `http://localhost:5173`.
- FFmpeg is shipped as a Tauri sidecar via `externalBin: ["bin/ffmpeg"]`.
- Release CI is `.github/workflows/build.yml`; it builds desktop artifacts for macOS arm64/x64, Linux x64, and Windows x64.

## Commands

- `pnpm dev`: full local stack (`tauri:dev` plus server dev).
- `pnpm dev:desktop`: desktop frontend dev server only.
- `pnpm build:desktop`: desktop frontend build only.
- `pnpm tauri:dev`: Tauri desktop dev app.
- `pnpm tauri:build`: Tauri desktop build.
- `pnpm --filter server dev`: server dev via `tsx watch src/index.ts`.
- `pnpm --filter server test`: server tests.
- `pnpm --filter desktop typecheck`: React Router typegen plus TypeScript.
- `cd packages/db && pnpm drizzle-kit generate`: generate migrations after schema edits.
- `cd packages/db && pnpm drizzle-kit push`: dev-only schema sync.

## Source Of Truth Files

- Server env validation: `apps/server/src/env.ts`.
- Desktop client env schema: `apps/desktop/app/env.ts`.
- Desktop loader-side DB env access: `apps/desktop/app/utils/env.server.ts`.
- Desktop routes/components: `apps/desktop/app/`.
- Tauri/Rust shell: `apps/desktop/src-tauri/src/lib.rs`.
- Server routes: `apps/server/src/routes/`.
- DB schema: `packages/db/src/schema.ts`.
- DB migrations: `packages/db/src/migrations/`.

Do not maintain duplicate env-var lists or line-number-based guidance here; inspect the files above.

## Hard Rules

- Do not run tests, typechecks, or browser/e2e verification unless the user explicitly asks or grants permission.
- Use evidence before editing bug fixes. Add probes/logs or inspect the live path before changing behavior.
- When changing visible UI copy, keep it concise and user-facing; avoid raw backend errors, table/storage names, cleanup mechanics, and implementation details.
- For new env usage, prefer extending typed env modules over direct `process.env` or `import.meta.env` reads in business code.
- Keep `import 'dotenv/config'` as the first line of `apps/server/src/index.ts`.
- Do not commit Tauri sidecar binaries: `apps/desktop/src-tauri/bin/ffmpeg-*`.
- Do not commit generated junk or unrelated untracked files.
- Do not use `select *` or whole-row selects on project list paths that can pull large JSON blobs such as `uiMessages`.
- For files importing from `ai` or `@ai-sdk/*`, read `docs/ai-sdk/README.md` and relevant local AI SDK notes before editing.

## Asset Ownership Model

- `media_files`: global per-content processing unit keyed by original-video SHA-256.
- `user_media_files`: a user's material-library ownership of a `media_files` row.
- `project_assets`: a project reference to a `user_media_files` row.
- Project asset deletion removes only the project reference.
- Library material deletion removes the `user_media_files` row and is blocked while any project still uses it.
- A `media_files` row may be deleted only after no `user_media_files` rows reference it.
- UI/LLM-facing asset ids for project chat and material search are `user_media_files.id`; legacy project references may still contain `project_assets.id`.
- Local desktop file lookup is keyed by SHA-256 in desktop SQLite, not by backend ids.

## Rust/Tauri Boundaries

- Rust owns local file metadata, FFmpeg sidecar execution, upload streaming, and server notification.
- Frontend must not parse local video metadata or call upload/notify webhooks directly.
- Heavy FFmpeg work is guarded by `Semaphore(1)` in `apps/desktop/src-tauri/src/lib.rs`.
- Upload/download progress events are throttled before frontend emit; do not emit raw high-frequency streams.
- Large file uploads use streaming (`FramedRead`); do not replace with whole-file reads.
- FFmpeg must run through Tauri shell sidecar APIs, not frontend code or ad-hoc process spawning.

## AI Workflow Rules

- `apps/server/src/routes/chat.ts` uses Vercel AI SDK tool calling. Do not improvise message or tool-call shapes.
- `MAX_STEPS` is defined in `chat.ts`; `prepareStep` must reference that constant, not hardcoded step numbers.
- Stop conditions include step count and final-tool signals such as `hasToolCall(...)`; remember `stopWhen` array entries are OR conditions.
- `generateEditingPlan` writes to the `editingPlans` table. Do not use the legacy `projects.editingPlans` JSON column for storage.
- LLM tool inputs can vary key casing; normalize with Zod preprocessing where needed.

## Browser/UI Verification

- Use the `agent-browser` skill for browser or UI verification tasks.

## Documentation Hygiene

- Prefer executable sources over old docs or plans when they disagree.
- If this file conflicts with package scripts, env schemas, Tauri config, or route/schema code, update this file.
- Keep this guide short. Add only durable facts or high-value rules.
- Prefer positive guidance that states the tool or behavior to use; keep exception rules short and tied to active risks.
