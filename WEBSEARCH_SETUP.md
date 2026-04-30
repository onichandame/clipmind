# Web Search Agent Tools — Node.js / Hono Setup Guide

Replicates the SearchAPI.io + Firecrawl agentic tool infrastructure from `prodream_backend` (Python/agno)
into a Hono server using the Vercel AI SDK.

---

## What This Sets Up

- **SearchAPI.io** — Google search wrapper, returns organic results
- **Firecrawl** — Webpage content extraction (markdown)
- Both wired as **Vercel AI SDK tools** into a `streamText` agentic loop
- Served via a **Hono** HTTP route with streaming response

---

## 1. Install Dependencies

```bash
npm install hono @hono/node-server ai @ai-sdk/openai zod p-retry @mendable/firecrawl-js
npm install -D typescript @types/node tsx
```

| Package | Role |
|---|---|
| `ai` | Vercel AI SDK — `tool()`, `streamText`, `toDataStreamResponse()` |
| `@ai-sdk/openai` | OpenAI provider (swap for any other AI SDK provider) |
| `zod` | Tool input schema validation |
| `p-retry` | Exponential backoff retry (replaces Python's `tenacity`) |
| `@mendable/firecrawl-js` | Official Firecrawl JS SDK |

---

## 2. Environment Variables

```bash
SEARCHAPI_KEY=<key from searchapi.io>
FIRECRAWL_API_KEY=<key from firecrawl.dev>
OPENAI_API_KEY=<your OpenAI key, or swap provider>
```

---

## 3. SearchAPI Service

**`src/services/searchapi.ts`**

```typescript
import pRetry from 'p-retry';

const SEARCHAPI_URL = 'https://www.searchapi.io/api/v1/search';

export interface SearchResult {
  title: string;
  link: string;
  snippet: string;
}

export async function googleSearch(
  query: string,
  pageSize = 5,
  excludeDomains: string[] = [],
): Promise<SearchResult[]> {
  return pRetry(
    async () => {
      const params = new URLSearchParams({
        engine: 'google',
        q: query,
        num: String(pageSize),
        api_key: process.env.SEARCHAPI_KEY!,
      });
      const res = await fetch(`${SEARCHAPI_URL}?${params}`);
      if (!res.ok) throw new Error(`SearchAPI ${res.status}: ${await res.text()}`);
      const data = await res.json();
      const results: SearchResult[] = (data.organic_results ?? []).map(
        (r: { title: string; link: string; snippet?: string }) => ({
          title: r.title,
          link: r.link,
          snippet: r.snippet ?? '',
        }),
      );
      return excludeDomains.length
        ? results.filter(r => !excludeDomains.some(d => r.link.includes(d)))
        : results;
    },
    { retries: 3, minTimeout: 2000, factor: 2 },
  );
}
```

**Notes:**
- `organic_results` is the key field in SearchAPI.io responses
- `p-retry` mirrors Python's `tenacity` `@retry(stop=stop_after_attempt(3), wait=wait_exponential(...))`
- No caching — every call hits SearchAPI.io directly

---

## 4. Firecrawl Service

**`src/services/firecrawl.ts`**

```typescript
import FirecrawlApp from '@mendable/firecrawl-js';

const client = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY! });

export async function scrapeWebpage(url: string): Promise<string | null> {
  try {
    const result = await client.scrapeUrl(url, {
      formats: ['markdown'],
      onlyMainContent: true,
      timeout: 30000,
    });
    return result.success ? (result.markdown ?? null) : null;
  } catch {
    return null;
  }
}
```

**Notes:**
- Returns `null` on any failure — tool layer handles the fallback message
- `onlyMainContent: true` strips nav/footer boilerplate (matches Python `only_main_content=True`)

---

## 5. Tool Definitions

### `src/tools/google-search.ts`

```typescript
import { tool } from 'ai';
import { z } from 'zod';
import { googleSearch } from '../services/searchapi.js';

export function makeSearchGoogleTool(opts?: {
  onThinking?: (text: string) => void;
  excludeWikipedia?: boolean;
}) {
  return tool({
    description: 'Search Google for up-to-date information on any topic.',
    inputSchema: z.object({
      query: z.string().describe('The search query'),
    }),
    execute: async ({ query }) => {
      opts?.onThinking?.(`Searching "${query}" on Google...\n\n`);
      const effectiveQuery = opts?.excludeWikipedia
        ? `${query} -site:wikipedia.org`
        : query;
      const results = await googleSearch(effectiveQuery);
      opts?.onThinking?.(`Found ${results.length} results\n\n`);
      return results
        .map(
          r =>
            `<result>\n<title>${r.title}</title>\n<url>${r.link}</url>\n<snippet>${r.snippet}</snippet>\n</result>`,
        )
        .join('\n');
    },
  });
}
```

### `src/tools/fetch-webpage.ts`

```typescript
import { tool } from 'ai';
import { z } from 'zod';
import { scrapeWebpage } from '../services/firecrawl.js';

export function makeFetchWebpageTool(opts?: {
  onThinking?: (text: string) => void;
}) {
  return tool({
    description: 'Fetch and read the full content of one or more web pages.',
    inputSchema: z.object({
      url: z
        .union([z.string(), z.array(z.string())])
        .describe('A URL or list of URLs to fetch'),
    }),
    execute: async ({ url }) => {
      const urls = Array.isArray(url) ? url : [url];
      const parts = await Promise.all(
        urls.map(async u => {
          opts?.onThinking?.(`Reading ${u}...\n\n`);
          const content = await scrapeWebpage(u);
          return `<webpage><url>${u}</url><content>${content ?? 'Failed to fetch content'}</content></webpage>`;
        }),
      );
      return parts.join('\n\n');
    },
  });
}
```

### `src/tools/registry.ts`

Mirrors the Python `ToolRegistry` — selects tools based on session type.

```typescript
import { makeSearchGoogleTool } from './google-search.js';
import { makeFetchWebpageTool } from './fetch-webpage.js';

export type SessionType =
  | 'general'
  | 'research_match'
  | 'planning_assistant'
  | 'writing';

export function getToolsForSession(
  sessionType: SessionType = 'general',
  opts?: { onThinking?: (text: string) => void },
) {
  // writing sessions get no web tools
  if (sessionType === 'writing') return {};

  return {
    search_google: makeSearchGoogleTool({
      onThinking: opts?.onThinking,
      // research_match excludes Wikipedia (matches Python behaviour)
      excludeWikipedia: sessionType === 'research_match',
    }),
    fetch_webpage: makeFetchWebpageTool({
      onThinking: opts?.onThinking,
    }),
  };
}
```

---

## 6. Hono Route Handler

**`src/routes/chat.ts`**

```typescript
import { Hono } from 'hono';
import { streamText, isStepCount, convertToModelMessages } from 'ai';
import { openai } from '@ai-sdk/openai';
import { getToolsForSession, type SessionType } from '../tools/registry.js';

const chat = new Hono();

chat.post('/', async (c) => {
  const { messages, sessionType = 'general' } = await c.req.json<{
    messages: unknown[];
    sessionType?: SessionType;
  }>();

  const result = streamText({
    model: openai('gpt-4o'),
    messages: convertToModelMessages(messages),
    tools: getToolsForSession(sessionType),
    // allow up to 5 tool-call → response cycles
    stopWhen: isStepCount(5),
    system:
      'You are a helpful research assistant. Use your tools to find current, accurate information before answering.',
  });

  // toDataStreamResponse() returns a standard Response — Hono returns it directly
  return result.toDataStreamResponse();
});

export default chat;
```

**`src/index.ts`**

```typescript
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import chat from './routes/chat.js';

const app = new Hono();
app.route('/api/chat', chat);

serve({ fetch: app.fetch, port: 3000 }, () => {
  console.log('Server running on http://localhost:3000');
});
```

---

## 7. Project Structure

```
src/
├── services/
│   ├── searchapi.ts       # GoogleSearch HTTP client + retry
│   └── firecrawl.ts       # Firecrawl scraper
├── tools/
│   ├── google-search.ts   # search_google tool definition
│   ├── fetch-webpage.ts   # fetch_webpage tool definition
│   └── registry.ts        # session-type → tool set mapping
├── routes/
│   └── chat.ts            # POST /api/chat route
└── index.ts               # Hono app entry point
```

---

## 8. Test It

```bash
# Start the server
npx tsx src/index.ts

# Send a test request
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "What is the latest news about AI agents?"}],
    "sessionType": "general"
  }'
```

You should see a streamed response with interleaved text deltas and tool call events.

---

## 9. Key Differences from Python Implementation

| Concern | Python (agno) | Node.js (Vercel AI SDK + Hono) |
|---|---|---|
| Tool definition | `@tool(name="...")` agno decorator | `tool({ inputSchema, execute })` |
| Retry logic | `tenacity` `@retry` decorator | `p-retry` |
| Multi-step loop | Agno handles internally | `stopWhen: isStepCount(5)` |
| Caching | MongoDB 7-day TTL | Not included |
| SSE thinking events | `sse_handler.emit_event("thinking", ...)` | `onThinking` callback |
| Firecrawl | Raw `httpx` requests | `@mendable/firecrawl-js` SDK |
| Response streaming | FastAPI `StreamingResponse` | `result.toDataStreamResponse()` |
| Wikipedia exclusion | Appended to query string | `excludeWikipedia` flag in registry |

---

## 10. Extending

**Add a new session type:**
Edit `registry.ts` — add to the `SessionType` union and add a branch in `getToolsForSession`.

**Add a new tool:**
1. Create `src/tools/my-tool.ts` exporting a `makeMyTool()` function
2. Return `tool({ inputSchema: z.object({...}), execute: async (...) => ... })`
3. Register it in `registry.ts`

**Add caching (optional):**
Wrap the `pRetry` block in `searchapi.ts` with a Redis/Vercel KV lookup before the fetch,
and a store after. Use the query string as the cache key with a 7-day TTL.
