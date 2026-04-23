# Backend AI SDK Patterns

## streamText — canonical setup for ClipMind

```ts
import {
  streamText, tool, convertToModelMessages,
  UIMessage, stepCountIs, hasToolCall,
  SystemModelMessage,
} from 'ai';

const result = streamText({
  model,
  system: finalSystemPrompt,
  messages: safeMessages,          // CoreMessage[] — always use convertToModelMessages()
  maxRetries: 3,
  stopWhen: [
    stepCountIs(MAX_STEPS),
    hasToolCall('generateEditingPlan'),
  ],
  prepareStep: async ({ stepNumber, messages }) => {
    if (stepNumber === MAX_STEPS - 1) {
      // Do NOT mutate the messages array directly
      // Return a new system string instead:
      return {
        toolChoice: 'none',
        system: finalSystemPrompt + '\n\n[Final step — no tools, must output text]',
      };
    }
    return {};
  },
  tools: { ... },
  onStepFinish: async ({ toolResults }) => { /* optional per-step logging */ },
  onFinish: async ({ response }) => { /* persist to DB */ },
});

return result.toUIMessageStreamResponse();
```

## stopWhen

`stepCountIs` is the correct export name in `ai@^6.x`. `isStepCount` does not exist — do not use it.

```ts
// ✅ Correct (ai@^6.x)
import { stepCountIs, hasToolCall } from 'ai';
stopWhen: [stepCountIs(20), hasToolCall('generateEditingPlan')]
```

## prepareStep — safe pattern

The `messages` array passed to `prepareStep` is the live internal state; mutating it is unsafe and produces hard-to-trace bugs. Return a new `system` string instead:

```ts
// ❌ Mutates internal state
prepareStep: async ({ stepNumber, messages }) => {
  const systemMsg = messages.find(m => m.role === 'system') as SystemModelMessage;
  systemMsg.content += '\n\nFinal step warning'; // mutating reference — unsafe
  return { toolChoice: 'none', system: systemMsg };
}

// ✅ Returns new value, no mutation
prepareStep: async ({ stepNumber }) => {
  if (stepNumber === MAX_STEPS - 1) {
    return {
      toolChoice: 'none',
      system: finalSystemPrompt + '\n\n[Final step — output text only]',
    };
  }
  return {};
}
```

## tool() — correct definition

```ts
import { tool } from 'ai';
import { z } from 'zod';

const myTool = tool({
  description: '...',
  inputSchema: z.object({ ... }),   // NOT parameters (deprecated)
  execute: async (input) => { ... },
});
```

## Message history — safe conversion

Never manually reconstruct CoreMessage from UIMessage. Always use `convertToModelMessages`:

```ts
// ✅ Correct
const userCoreMessages = await convertToModelMessages([lastUserMsg]);

// ❌ Fragile manual reconstruction
const userCoreMessages = [{ role: 'user', content: lastUserMsg.content }];
// UIMessage.content is empty in v6+; text lives in .parts
```

For persisted history, the project stores raw messages (mixed UIMessage/CoreMessage) in `projects.uiMessages`. The current manual cleanup loop in `coreHistory` is a workaround for this. A cleaner long-term fix would be to store CoreMessage[] separately from UIMessage[].

## onFinish — persistence pattern

```ts
onFinish: async ({ response }) => {
  // response.messages contains the assistant turns from this call
  // Combine with what was passed in to get full updated history
  const updatedMessages = [...coreHistory, ...userCoreMessages, ...response.messages];
  await db.update(projects)
    .set({ uiMessages: updatedMessages })
    .where(eq(projects.id, projectId));
}
```

Do NOT re-query the project inside `onFinish` — you already have the full history from the closure.

## generateText — non-streaming

For fire-and-forget LLM calls (e.g. asset summarisation):

```ts
import { generateText } from 'ai';

const { text } = await generateText({
  model: createAIModel(),
  system: '...',
  prompt: transcript,
});
```

## embedMany — batch embeddings

```ts
import { embedMany } from 'ai';

const { embeddings } = await embedMany({
  model: provider.embedding('text-embedding-3-small'),
  values: texts,
});
```

## Package version

The server `package.json` should pin to a specific version, not `"latest"`:

```json
// ❌
"ai": "latest"

// ✅
"ai": "^6.0.154"   // or whatever the current pinned version is
```

`"latest"` resolves at install time and can silently upgrade across major versions between deployments.
