# Long-Term User Memory (USER.md-style)

Per-user markdown blob stored on `users.memory_md`, injected into the chat
system prompt on every request. Lets the assistant carry stable user
facts (role, creation preferences, workflow habits) across projects so it
doesn't re-introduce itself in every new conversation.

## Storage

| Column | Type | Purpose |
|---|---|---|
| `users.memory_md` | `text` (nullable) | Markdown blob, ≤ 12 KB at write time, ≤ 6 KB after compaction |
| `users.memory_updated_at` | `timestamp` (nullable) | Last write or compaction time. Used by the cron to decide what to compact |

Migration: `packages/db/src/migrations/0006_exotic_kat_farrell.sql`.

## Read path — system prompt injection

`apps/server/src/routes/chat.ts` runs a single-row query on every chat
request right after the project lookup, and prepends a `## 关于你正在对话的用户`
block to `dynamicSystemPrompt` **before** the workflow-mode block — so the
model sees the user profile first, then the project context.

Empty / null memory → injection is skipped. Zero migration overhead for
historic users.

Memory is **only** read in the chat route. Hotspot pipeline, ASR
summarization, and other LLM calls do not see it.

## Write path — `update_user_memory` tool

Defined alongside `request_asset_import` / `show_hotspots` in
`apps/server/src/routes/chat.ts`. Channel D (silent), no `stopCondition` —
the model continues its turn after writing.

```ts
update_user_memory({
  contentMd: string,  // full rewrite, max 12_000 chars (Zod-enforced)
  reason: string,     // why this update; for telemetry / debugging
})
```

Always **full rewrite, not diff**. The model sees the current memory in
the system prompt, treats it as a draft, merges new facts, drops stale
entries, and submits the complete new version.

Prompt rules constrain the model to:
- Only save **cross-project stable** info (identity, creation preferences, workflow habits, explicit user feedback).
- Never save: project-internal facts, ephemeral state, sensitive PII (email, phone, address, payment) unless the user explicitly asks.
- Cap: ≤ 2 calls per session.
- "宁可漏写、不能错写" — prefer omission over speculation, because **there is no undo path**.

The tool returns `{ success, before, after, reason }` for debugging /
audit. The frontend ignores `before` / `after` content (toast is
data-free) but the values persist in `projects.uiMessages` and can be
read directly from DB if you ever need to reconstruct what was written.

## Frontend — silent toast, no settings UI

`apps/desktop/app/components/MemoryUpdateToast.tsx` — non-interactive
fixed bottom-right notification. 5s auto-dismiss. **No expand button, no
diff viewer, no undo, no clear-all, no settings page.** Per product
stance (memory `feedback_ai_internals_opaque_in_ux.md`), AI-internal
mechanics stay opaque.

`ChatPanel.tsx` watches for `tool-update_user_memory` parts with
`state === 'output-available'`, dedupes by `toolCallId` via a `useRef<Set>`,
ignores existing parts on first mount (so reloading a session doesn't
re-fire historic toasts), and bumps a nonce that the toast component
keys off.

The tool part is registered in `SILENT_TOOL_NAMES` (separate from
`WIDGET_TOOL_NAMES`) in `widgets/registry.ts` so it's filtered out of
the transcript, status pills, and the "active tool" thinking-bubble
suppression check.

User error correction path: there is no UI button. The user must say
"不对，我不是做美食的" and let the model self-correct via another
`update_user_memory` call.

## Compaction — nightly cron

`apps/server/src/jobs/memory-compaction.ts` registers a `0 3 * * *` cron
in `startMemoryCompactionJob()`, wired up alongside the hotspots and
OSS-cleanup jobs in `apps/server/src/index.ts`.

Selection criteria for compaction (must satisfy all):
- `memory_md IS NOT NULL`
- `CHAR_LENGTH(memory_md) >= 4000`
- `memory_updated_at < NOW() - INTERVAL 12 HOUR`

For each candidate: send the current memory to `generateText` with a
prompt asking for a deduped, ≤ 6 KB rewrite preserving facts. Only
overwrite if the new version is at least 5% smaller (avoids burning DB
writes for negligible gains).

`runMemoryCompaction()` is exported and can be invoked manually for
testing.

## Disabling

To turn off the feature without ripping out the schema:
1. Delete the `if (userMemoryMd)` injection block in `chat.ts`.
2. Remove `update_user_memory` from the `tools` map.
3. Comment out `startMemoryCompactionJob()` in `index.ts`.

Schema columns can stay — they're nullable and zero-cost when unused.

## Gotcha — Drizzle migration journal `when` ordering

Drizzle's mysql migrator (`mysql-core/dialect.cjs`) decides whether to
apply a migration with:

```js
if (Number(lastDbMigration.created_at) < migration.folderMillis) { apply() }
```

`folderMillis` comes from the journal's `when` field. **If a new
migration's `when` is older than the most-recent applied migration's
`when`, Drizzle silently skips it.** No error, no log line.

`packages/db/src/migrations/meta/_journal.json` has manually-bumped
future-dated `when` values for 0003–0005. When 0006 was first generated
with the real `Date.now()`, it was older than 0005's bumped value and
got skipped on prod, surfacing as `Unknown column 'memory_md'` in chat.

The fix landed: 0006's `when` was bumped to be greater than 0005's. **Any
new migration must continue to use a `when` greater than the current
max.** Until 0003–0005 are normalized, regenerated migrations will need
manual journal edits.

## Key files

| File | Role |
|---|---|
| `packages/db/src/schema.ts:8-16` | `users.memoryMd` + `memoryUpdatedAt` columns |
| `packages/db/src/migrations/0006_exotic_kat_farrell.sql` | Migration |
| `apps/server/src/routes/chat.ts` | Read-and-inject + `update_user_memory` tool + D-channel prompt rules |
| `apps/server/src/jobs/memory-compaction.ts` | Nightly compaction cron |
| `apps/server/src/index.ts` | Wires `startMemoryCompactionJob()` |
| `apps/desktop/app/components/MemoryUpdateToast.tsx` | Non-interactive toast |
| `apps/desktop/app/components/ChatPanel.tsx` | Detect `tool-update_user_memory` parts → fire toast; suppress part from transcript |
| `apps/desktop/app/components/widgets/registry.ts` | `SILENT_TOOL_NAMES` set |
