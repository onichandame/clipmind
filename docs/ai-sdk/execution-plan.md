# AI SDK — Execution Plan

Companion to `docs/ai-sdk/improvements.md`. This document audits each item against the current code (as of 2026‑04‑23), refines scope where the original list was imprecise, and orders the work into executable phases with exact file:line anchors.

---

## Audit summary

All 10 items reproduce against the current tree. Details that differ from `improvements.md`:

| # | Claim in improvements.md | Actual state | Adjustment |
|---|---|---|---|
| 1 | `chat.ts:4` imports `stepCountIs` | ✅ confirmed (line 4) and used at line 136 | none |
| 2 | First `search_clips` is at "~line 310" | ✅ lines 310–341 (wrong schema `action`+`assetIds`); correct at 343–377 | **CLAUDE.md hard‑rule cites lines 273–304 — that range is stale and must be updated when item 2 lands** |
| 3 | `ChatPanel.tsx:246` uses deprecated API | ✅ confirmed (lines 246–298, plus fallback state checks on 280 and elsewhere) | also update the outline‑streaming `useEffect` at lines 92–104 to use `input-streaming`/`input-available` explicitly rather than relying on any state |
| 4 | `"ai": "latest"` on server | ✅ `apps/server/package.json:14` | desktop pin is `^6.0.154` (line 27); pin server to the same floor |
| 5 | `prepareStep` mutates messages | ✅ lines 142–150 mutate `systemMsg.content` | none |
| 6 | `onFinish` re‑queries project | ✅ lines 384–404 — `db.select({ uiMessages })` is unused except for an existence check | none |
| 7 | `console.log` of full prompt at "~line 136" | ✅ actually lines 128–130 | minor line offset only |
| 8 | `projects.uiMessages` typed as `UIMessage[]` in schema | ❗ partial: schema (`packages/db/src/schema.ts:44`) types it as plain `json().default([])`, i.e. `unknown`. The "typed as UIMessage[]" framing comes from frontend/server consumers, not the drizzle schema. | reword in improvements.md when ticking the item off; the *real* issue is a consumer‑side type contract, not a drizzle typo |
| 9 | Prompt built by ~80 lines of `+=` | ✅ lines 25–97 in `chat.ts` | none |
| 10 | `onStepFinish` not wired up | ✅ absent from `streamText` call | none |

No items were dropped. Items 2 and 3 grew in scope by one touch each (CLAUDE.md rule, extra useEffect). Item 8 is downgraded in urgency because the schema itself is not lying — only the callers are casting loosely.

---

## Refined ordering

Original severity buckets (🔴/🟡/🟢) are a good read on impact. For execution, the right order is driven by **risk of regression** and **dependency between items**, which produces four phases:

### Phase 0 — Unpin & lockstep (do first)
Before changing any SDK‑shape code, guarantee we know which SDK version we are building against. This is Item 4.

### Phase 1 — Deprecation removals that will hard‑break on the next bump
Items 1, 3 — deprecated imports / APIs that still resolve today but are scheduled for removal. Do them while the pin (Phase 0) is fresh so we can bump safely later.

### Phase 2 — Latent correctness fixes
Items 2, 5, 6 — dead/unsafe code that works today but corrupts behavior under the wrong conditions (concurrent writes, retries, refactors).

### Phase 3 — Hygiene and observability
Items 7, 10 — low‑risk logging changes. Safe to batch.

### Phase 4 — Architectural notes (opt‑in, not scheduled)
Items 8, 9 — refactors with no bug attached. Leave as unblocked backlog. Don’t bundle with the bug fixes above.

---

## Phase 0 — Pin server `ai` (Item 4)

**Single file:** `apps/server/package.json`

```diff
- "ai": "latest",
+ "ai": "^6.0.154",
```

**Why first:** fixing items 1 and 3 is a bet about which APIs the installed SDK supports. `"latest"` can slide under us between `pnpm install` runs. Freezing the floor to `^6.0.154` (what desktop already uses) means the two apps compile against the same major, and the deprecation fixes below are testable.

**Validation:** `pnpm install --filter server` should resolve to `6.0.x`. No runtime change expected (both names still resolve at `^6.0`).

---

## Phase 1 — Drop deprecated AI SDK surface

### 1.1 ✅ DONE — `stepCountIs` kept (Item 1 was incorrect)

`isStepCount` does not exist in `ai@^6.x`. The original `stepCountIs` is correct and was retained. The claim in improvements.md that it was deprecated was wrong.

### 1.2 Frontend: typed tool parts (Item 3)

**File:** `apps/desktop/app/components/ChatPanel.tsx`

Two blocks need updating:

**(a) The main tool renderer at lines 246–298.** Replace the filter predicate and the destructuring with a `switch`‑style map keyed on `part.type === 'tool-<name>'`, and rename state strings:

| Old | New |
|---|---|
| `p.type === 'tool-invocation' \|\| p.toolCallId \|\| p.type?.startsWith('tool-')` | `isToolUIPart(p)` |
| `invocation.toolInvocation` / `invocation.args` / `invocation.result` | `p.input` / `p.output` |
| `state === 'call'` | `state === 'input-available'` |
| `state === 'partial-call'` | `state === 'input-streaming'` |
| `state === 'result'` | `state === 'output-available'` |
| `state === 'streaming'` | `state === 'input-streaming'` |

Keep the existing UI affordances (spinner for streaming, success card for `generateEditingPlan`) — only swap the accessors and state strings.

**(b) The outline‑streaming `useEffect` at lines 92–104** already uses `isToolUIPart`, but it reads `outlinePart?.input` without checking `state`. After this phase, tighten it to only write to the store when `state === 'input-streaming' || state === 'input-available'` so partial JSON doesn’t flash into the canvas.

**Validation:** manual in Tauri dev — trigger `updateOutline` and `generateEditingPlan` calls and confirm the spinner → success transitions render. No types to run (see CLAUDE.md testing policy).

---

## Phase 2 — Latent correctness fixes

### 2.1 Remove duplicate `search_clips` (Item 2)

**File:** `apps/server/src/routes/chat.ts`

- **Delete lines 310–341** (the first `search_clips` block — a copy of `manage_footage_basket` mis‑keyed and with a broken execute body).
- **Keep lines 343–377** (the correct `search_clips` with `query` / `assetIds` / `limit`).
- **Edit CLAUDE.md** "Hard Rules (Red Lines)" section to drop the `Do not touch lines 273–304` rule entirely — the rule exists solely to guard this duplicate, and once it is gone the rule is obsolete (and its line numbers were already stale: the real duplicate was at 310–341, not 273–304).

**Safety:** duplicate object keys in an object literal — the second wins at runtime, so removing the first causes no behavior change. The risk is purely a line‑number shift for downstream debugging. Do this change as its own commit so the diff is obvious.

### 2.2 `prepareStep` — stop mutating messages (Item 5)

**File:** `apps/server/src/routes/chat.ts` lines 139–153

Current:
```ts
prepareStep: async ({ stepNumber, messages }) => {
  if (stepNumber === MAX_STEPS - 1) {
    const systemMsg = messages.find(msg => msg.role === `system`) as SystemModelMessage
    systemMsg.content += '\r\n【系统高优先级警告】...'
    return { toolChoice: 'none', system: systemMsg };
  }
  return {};
},
```

Target:
```ts
prepareStep: async ({ stepNumber }) => {
  if (stepNumber === MAX_STEPS - 1) {
    return {
      toolChoice: 'none',
      system: finalSystemPrompt + '\n\n【系统高优先级警告】：这是你本次响应的最后一步。当前所有工具已被禁用。你必须立刻根据上文的所有对话历史和已获取的工具结果，输出一段面向用户的最终纯文本总结。严禁直接终止对话。',
    };
  }
  return {};
},
```

Notes:
- Drop the `messages` parameter — no longer read.
- Return `system` as a string, not a `SystemModelMessage` object (the SDK accepts both but string is the idiomatic form and matches the initial `system` prop at line 134).
- Drop the `\r\n` (Windows line ending — cosmetic, but `\n` is what the rest of the prompt uses).
- The `SystemModelMessage` import becomes unused after this change — remove it from line 4.

### 2.3 `onFinish` — stop the redundant DB roundtrip (Item 6)

**File:** `apps/server/src/routes/chat.ts` lines 379–410

Replace the existingProject fetch + reconstruction with the closure values already in scope:

```ts
onFinish: async ({ response }) => {
  try {
    const updatedMessages = [...coreHistory, ...userCoreMessages, ...response.messages];
    await db.update(projects)
      .set({ uiMessages: updatedMessages })
      .where(eq(projects.id, projectId));
    console.log(`[Chat] ✅ 对话持久化成功，当前总消息数: ${updatedMessages.length}`);
  } catch (error) {
    console.error(`❌ [Chat] 对话持久化失败:`, error);
  }
}
```

**Why this is strictly safer:** today’s code reads `existingMessages` but never uses it — `updatedMessages` is assembled from `coreHistory` and `userCoreMessages`, both captured at the top of the request. The read is pure overhead, and under concurrent requests to the same project it can race the other tab’s write. Dropping it is a behavior fix, not just a perf tweak.

**Guard to preserve:** the current code early‑returns if the project row has disappeared between request start and stream end. With the closure‑only approach, the `update` will silently match 0 rows and that is fine — log at warn level if row‑count is 0 if we want parity with the old warning.

---

## Phase 3 — Observability hygiene

### 3.1 Remove / gate the full‑prompt log (Item 7)

**File:** `apps/server/src/routes/chat.ts` lines 128–130

Minimal fix — delete the three lines outright. If we want a toggle, gate behind `process.env.DEBUG_PROMPT === '1'` (a one‑line `if`), but do not add a new env var to the schema for this — it should be an opt‑in local debug flag only.

```diff
- console.log('--- [Debug] Dynamic System Prompt ---');
- console.log(finalSystemPrompt);
- console.log('-------------------------------------');
```

### 3.2 Add `onStepFinish` for per‑step tool logging (Item 10)

**File:** `apps/server/src/routes/chat.ts`, inside the `streamText({ ... })` call

```ts
onStepFinish: async ({ toolResults }) => {
  if (toolResults?.length) {
    console.log(`[Step] tools:`, toolResults.map(t => t.toolName).join(', '));
  }
},
```

Keep it terse — one line per step, tool names only. Do not log tool inputs/outputs; those can contain asset IDs and transcript snippets (same leak category as Item 7).

---

## Phase 4 — Backlog (not scheduled)

These are architectural notes. They have no bug attached and should not be bundled with Phases 0–3.

- **Item 8 — Split `uiMessages` into `uiMessages` (UI‑shaped) + `coreHistory` (CoreMessage‑shaped).** Requires a migration, a new writer path on the frontend, and a read compatibility shim for existing rows. Only worth it if we hit a bug the current `coreHistory` cleanup loop can’t handle. Reword the claim in improvements.md when revisiting: the drizzle schema types `uiMessages` as plain `json()`, not `UIMessage[]` — the mismatch lives in the consumers (frontend `useChat.initialMessages`, server `convertToModelMessages` reconstruction), not in the schema column type.
- **Item 9 — Extract `buildSystemPrompt({ project, outline, assets, ... })`.** Pure readability. Good candidate right after 2.2 since `finalSystemPrompt` becomes referenced in two places (the `streamText` call and `prepareStep`), which is a mild nudge toward a helper. Still optional.

---

## Recommended commit shape

One PR per phase, in order:

1. **chore(server): pin `ai` to `^6.0.154`** — Item 4.
2. **refactor(ai-sdk): drop deprecated SDK surface** — Items 1 + 3 together. Same SDK‑version prerequisite, low blast radius once 4 has landed.
3. **fix(chat): remove duplicate search_clips, stabilise prepareStep and onFinish** — Items 2 + 5 + 6. Also edits CLAUDE.md to drop the stale hard rule.
4. **chore(chat): scrub prompt log, add step logger** — Items 7 + 10.

Phase 4 (Items 8, 9) stays in the backlog and should not be opened unless revisited explicitly.

---

## Verification notes per phase

Per CLAUDE.md: **do not run `tsc`, `tsx`, typecheck, or test commands.** The user does e2e manual verification. For each phase, hand the branch over with a specific smoke‑test checklist:

- Phase 0: `pnpm install` clean, server boots.
- Phase 1: start a new project, send a message that hits `search_assets` then `updateOutline` then `generateEditingPlan`; confirm streaming spinner → success transitions are visually intact, and confirm the ReAct loop still stops at `generateEditingPlan`.
- Phase 2: open two tabs to the same project, trigger overlapping prompts; confirm no history corruption. Force a 20‑step overflow and confirm the final‑step text summary still renders (validates the new `prepareStep` `system` string).
- Phase 3: confirm server logs show `[Step] tools: ...` per ReAct turn and no longer dump the full prompt.

---

## Out of scope

- Upgrading `zod` on the server (it’s `^3.0.0` — very loose, but orthogonal to the AI SDK work).
- Any change to the Rust asset pipeline.
- Bumping `ai` past `^6.x` — Phase 0 pins the floor only; a major bump is a separate exercise.
