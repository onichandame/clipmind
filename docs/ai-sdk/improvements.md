# AI SDK — Improvement List

Ordered by severity. Items 1–3 are bugs or deprecated APIs that will break on the next major SDK version.

---

## 🔴 High priority

### 1. ✅ DONE — `stepCountIs` is the correct name in `ai@^6.x`

`isStepCount` does not exist in `ai@^6.x`. Use `stepCountIs`. This item was incorrectly documented as a rename; it has been reverted.

---

### 2. Duplicate `search_clips` tool — first definition has wrong schema

**File:** `apps/server/src/routes/chat.ts` (first `search_clips` ~line 310)

The first `search_clips` definition is a copy-paste of `manage_footage_basket` with the wrong schema (`action` + `assetIds` instead of `query` + `assetIds` + `limit`) and wrong execute body. JavaScript silently overrides it with the second (correct) definition, but this is dead, confusing code that could cause accidental regressions during refactoring.

**Fix:** Delete the first `search_clips` block entirely. Keep only the second one (the correct one with `query`, `assetIds`, `limit`).

> Note: CLAUDE.md currently says "do not touch lines 273–304" — that's specifically the first (wrong) block. The correct fix is to remove it, but coordinate with the team first.

---

### 3. Frontend tool part rendering uses deprecated `tool-invocation` API

**File:** `apps/desktop/app/components/ChatPanel.tsx` ~line 246

The rendering code checks `p.type === 'tool-invocation'` and accesses `p.toolInvocation.state / .args / .result` — all deprecated in SDK v5+. New API uses typed parts (`'tool-{toolName}'`) and `p.state / p.input / p.output`.

```tsx
// Before (deprecated)
parts.filter(p => p.type === 'tool-invocation' || p.toolCallId || p.type?.startsWith('tool-'))
  .map(p => {
    const invocation = p.type === 'tool-invocation' ? p.toolInvocation : p;
    const state = invocation.state || p.state;  // 'call' | 'partial-call' | 'result'
    const toolName = invocation.toolName || p.toolName || p.type;
  })

// After (current SDK)
parts.filter(p => isToolUIPart(p))
  .map(p => {
    // p.type is 'tool-generateEditingPlan', 'tool-updateOutline', etc.
    // p.state is 'input-streaming' | 'input-available' | 'output-available'
    // p.input  (replaces args)
    // p.output (replaces result)
  })
```

Also update state comparisons:
- `state === 'call'` → `state === 'input-available'`
- `state === 'partial-call'` → `state === 'input-streaming'`
- `state === 'result'` → `state === 'output-available'`
- `state === 'streaming'` → `state === 'input-streaming'`

---

## 🟡 Medium priority

### 4. `"ai": "latest"` on server — unpin to specific version

**File:** `apps/server/package.json`

`"latest"` resolves at install time and can silently cross a major version boundary between deployments. Desktop already pins `"ai": "^6.0.154"`. Server should match.

```json
"ai": "^6.0.154"
```

---

### 5. `prepareStep` mutates the messages array

**File:** `apps/server/src/routes/chat.ts`, `prepareStep` callback

```ts
// Before — mutates internal SDK state
const systemMsg = messages.find(msg => msg.role === 'system') as SystemModelMessage;
systemMsg.content += '\r\n[Final step warning]';
return { toolChoice: 'none', system: systemMsg };

// After — return a fresh system string
return {
  toolChoice: 'none',
  system: finalSystemPrompt + '\n\n[Final step — output text only]',
};
```

Mutating the `messages` reference inside `prepareStep` is unsafe because it modifies the SDK's live internal state across retries.

---

### 6. `onFinish` re-queries the project unnecessarily

**File:** `apps/server/src/routes/chat.ts`, `onFinish` callback

The callback re-fetches the project from DB to get `uiMessages`, then reconstructs history. But `coreHistory` + `userCoreMessages` are already in the closure and already represent the full history that was sent to the model. The re-fetch adds a DB roundtrip and can produce inconsistent results under concurrent requests.

```ts
// Before
onFinish: async ({ response }) => {
  const existingProject = await db.select({ uiMessages: ... }) ...  // unnecessary
  ...
  const updatedMessages = [...coreHistory, ...userCoreMessages, ...response.messages];
}

// After — just use the closure
onFinish: async ({ response }) => {
  const updatedMessages = [...coreHistory, ...userCoreMessages, ...response.messages];
  await db.update(projects).set({ uiMessages: updatedMessages }).where(...);
}
```

---

### 7. Remove production `console.log` of full system prompt

**File:** `apps/server/src/routes/chat.ts` ~line 136

```ts
console.log('--- [Debug] Dynamic System Prompt ---');
console.log(finalSystemPrompt);   // logs the full prompt including user asset IDs
console.log('-------------------------------------');
```

This leaks asset IDs, user outline content, and injected RAG context to server logs on every request. Remove or gate behind a `DEBUG` env flag.

---

## 🟢 Low priority / architecture notes

### 8. Message storage type mismatch

`projects.uiMessages` is typed as `UIMessage[]` in the schema but the server writes `CoreMessage[]` (the result of `convertToModelMessages` + `response.messages`). The frontend reads these back and passes them as `initialMessages` to `useChat`. This works because `useChat` can handle both, but the type mismatch creates confusion and the manual `coreHistory` cleanup loop in chat.ts exists to work around accumulated drift.

Long-term fix: store `CoreMessage[]` in a separate `projects.coreHistory` column, and keep `uiMessages` as true `UIMessage[]` written by the frontend or by a proper serialisation step.

### 9. System prompt length and structure

The dynamic system prompt is assembled via repeated string concatenation across ~80 lines of `+=`. This makes it hard to audit what's actually sent to the model. Consider extracting prompt sections into named template functions or a dedicated `buildSystemPrompt({ project, outline, assets, ... })` helper.

### 10. `onStepFinish` hook not used for observability

`streamText` supports `onStepFinish` which fires after each tool step with the tool results. Currently there is no per-step logging on the server (only an `onFinish`). Adding `onStepFinish` would make the ReAct loop much easier to debug in production without the full-prompt log.

```ts
onStepFinish: async ({ stepNumber, toolResults }) => {
  if (toolResults.length) {
    console.log(`[Step ${stepNumber}] Tools:`, toolResults.map(t => t.toolName));
  }
},
```
