# AI SDK Knowledge Base

This directory documents how the Vercel AI SDK is used correctly in ClipMind.

> SDK versions in use: server `ai@latest` (⚠️ unpin needed), desktop `ai@^6.0.154`  
> Provider: `@ai-sdk/openai@^3.0.52` on both

## Files

| File | Contents |
|------|----------|
| [backend-patterns.md](./backend-patterns.md) | `streamText`, tools, `stopWhen`, `prepareStep`, `onFinish` |
| [frontend-patterns.md](./frontend-patterns.md) | `useChat`, message parts, tool state rendering |
| [improvements.md](./improvements.md) | Prioritized list of things to fix |

## Quick Reference

### Imports (current correct names)

```ts
// Server
import { streamText, generateText, embedMany, tool, convertToModelMessages,
         UIMessage, stepCountIs, hasToolCall } from 'ai';

// Frontend
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, isToolUIPart } from 'ai';
```

### Correct tool part type strings (frontend)

Tool parts are typed as `tool-{toolName}`, not `tool-invocation`:

```ts
part.type === 'tool-generateEditingPlan'  // ✅
part.type === 'tool-invocation'           // ❌ deprecated
```

### Tool part states (current)

| Old (deprecated) | New (current) |
|-----------------|---------------|
| `'call'` | `'input-available'` |
| `'partial-call'` | `'input-streaming'` |
| `'result'` | `'output-available'` |
| `'streaming'` | `'input-streaming'` |
