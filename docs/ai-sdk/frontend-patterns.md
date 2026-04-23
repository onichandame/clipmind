# Frontend AI SDK Patterns

## useChat — setup

```ts
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, isToolUIPart } from 'ai';

const { messages, sendMessage, status } = useChat({
  id: projectId,
  messages: initialMessages,
  transport: new DefaultChatTransport({
    api: `${env.VITE_API_BASE_URL}/api/chat`,
    body: { projectId, currentOutline, isDirty },
  }),
  onError: (err) => console.error(err),
  onFinish: (event) => {
    // Detect last tool called
    const allTools = event.messages.flatMap(m =>
      m.parts?.filter(p => isToolUIPart(p)).map(p => p.type) ?? []
    );
    const lastTool = allTools[allTools.length - 1];
    // lastTool is e.g. 'tool-generateEditingPlan'
  },
});
```

## Message parts — rendering

SDK v5+ uses **typed tool parts** (`part.type === 'tool-{toolName}'`) rather than a generic `tool-invocation` type.

```tsx
// ✅ Typed part approach (current SDK)
message.parts.map((part, i) => {
  switch (part.type) {
    case 'text':
      return <span key={i}>{part.text}</span>;

    case 'tool-generateEditingPlan':
      if (part.state === 'output-available') {
        return <div key={i}>Plan saved ✅</div>;
      }
      return <div key={i}>Generating plan…</div>;

    case 'tool-updateOutline':
      if (part.state === 'input-available' || part.state === 'output-available') {
        // part.input.contentMd is available
      }
      break;
  }
});

// ❌ Old generic approach (deprecated)
message.parts
  .filter(p => p.type === 'tool-invocation')     // deprecated type
  .map(p => {
    const state = p.toolInvocation.state;         // deprecated: use p.state
    const args  = p.toolInvocation.args;          // deprecated: use p.input
    const result = p.toolInvocation.result;       // deprecated: use p.output
  });
```

## Tool part states

| State | Meaning |
|-------|---------|
| `'input-streaming'` | Tool input is being streamed (was `'partial-call'`) |
| `'input-available'` | Tool input complete, not yet executed (was `'call'`) |
| `'output-available'` | Tool executed, result ready (was `'result'`) |

The old state names (`'call'`, `'partial-call'`, `'result'`, `'streaming'`) are deprecated.

## Accessing tool input/output

```tsx
// ✅ Typed part
if (part.type === 'tool-updateOutline' && part.state === 'input-available') {
  const md = part.input.contentMd;  // strongly typed
}
if (part.type === 'tool-generateEditingPlan' && part.state === 'output-available') {
  const success = part.output.success;
}

// ❌ Old untyped approach
part.toolInvocation.args.contentMd    // deprecated
part.toolInvocation.result.success    // deprecated
```

## isToolUIPart — detecting any tool part

```ts
import { isToolUIPart } from 'ai';

const toolParts = message.parts.filter(p => isToolUIPart(p));
```

Use this for generic "any tool was called" checks. For specific tools, match `part.type === 'tool-{name}'` directly.

## Detecting last active tool (onFinish)

```ts
onFinish: (event) => {
  const allToolTypes = event.messages.flatMap(m =>
    (m.parts ?? []).filter(p => isToolUIPart(p)).map(p => p.type)
  );
  const lastTool = allToolTypes[allToolTypes.length - 1];
  // 'tool-generateEditingPlan', 'tool-search_assets', etc.
}
```

## Streaming outline from tool input (live update)

The current pattern listens for `tool-updateOutline` input parts mid-stream to preview the outline before the tool finishes executing:

```ts
useEffect(() => {
  const last = messages[messages.length - 1];
  const outlinePart = last?.parts
    ?.filter(p => isToolUIPart(p))
    .find(p => p.type === 'tool-updateOutline');

  // Correct v5+ access:
  if (outlinePart?.state === 'input-available' || outlinePart?.state === 'input-streaming') {
    const md = (outlinePart as any).input?.contentMd;
    if (md) setOutlineContent(projectId, md, 'agent');
  }
}, [messages, status]);
```

## sendMessage

```ts
// Simple text
sendMessage({ text: 'Hello' });

// With extra body (overrides transport body for this call)
sendMessage(
  { text: content },
  { body: { projectId, currentOutline, isDirty } }
);
```

## Chat status values

```ts
const isLoading = status === 'streaming' || status === 'submitted';
// Other values: 'ready', 'error'
```
