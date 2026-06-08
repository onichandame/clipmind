import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { and, eq } from 'drizzle-orm';
import { readUIMessageStream, type UIMessage } from 'ai';
import { db } from '../db';
import { projects } from '@clipmind/db/schema';
import { requireAuth } from '../middleware/auth';
import { buildChatStream } from './chat';
import { insertOrReplaceAfterMessage, normalizeChatHistory, visibleChatMessages, type ChatHistory } from '../chat/history';

const OUTLINE_EDITED_REMINDER = '<system-reminder>用户刚刚手动修改了右侧大纲。你必须以数据库中的最新大纲为准，不要沿用旧对话里的大纲内容。</system-reminder>';
const RUN_IDLE_TTL_MS = 60_000;
const STREAM_BROADCAST_MS = 100;

type Subscriber = {
  send: (event: string, data: unknown) => void;
};

type PendingTurn = {
  userMessageId: string;
  outlineEdited: boolean;
  modelAlreadyAppended: boolean;
};

type ChatRun = {
  key: string;
  projectId: string;
  userId: string;
  uiMessages: any[];
  modelMessages: any[];
  liveAssistantMessage: any | null;
  subscribers: Set<Subscriber>;
  pendingTurns: PendingTurn[];
  isStreaming: boolean;
  revision: number;
  cleanupTimer: ReturnType<typeof setTimeout> | null;
  autoContinuedLastUserId: string | null;
};

const runs = new Map<string, ChatRun>();

function runKey(userId: string, projectId: string) {
  return `${userId}:${projectId}`;
}

function textFromMessage(message: any) {
  if (typeof message?.content === 'string') return message.content;
  if (Array.isArray(message?.parts)) {
    return message.parts
      .filter((part: any) => part?.type === 'text' && typeof part.text === 'string')
      .map((part: any) => part.text)
      .join('');
  }
  return '';
}

function uiTextMessage(role: 'user' | 'assistant' | 'system', text: string, metadata?: Record<string, unknown>) {
  return {
    id: crypto.randomUUID(),
    role,
    parts: [{ type: 'text', text }],
    ...(metadata ? { metadata } : {}),
  };
}

function modelTextMessage(role: 'user' | 'assistant' | 'system', text: string) {
  return { role, content: text };
}

function toolTypesFrom(message: any) {
  return (message?.parts ?? [])
    .filter((part: any) => typeof part?.type === 'string' && part.type.startsWith('tool-'))
    .map((part: any) => part.type);
}

async function loadOwnedProject(projectId: string, userId: string) {
  const [project] = await db
    .select({ id: projects.id, chatHistory: projects.chatHistory })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1);
  return project;
}

async function getOrCreateRun(projectId: string, userId: string) {
  const key = runKey(userId, projectId);
  const existing = runs.get(key);
  if (existing) {
    if (existing.cleanupTimer) {
      clearTimeout(existing.cleanupTimer);
      existing.cleanupTimer = null;
    }
    return existing;
  }

  const project = await loadOwnedProject(projectId, userId);
  if (!project) return null;
  const history = normalizeChatHistory(project.chatHistory);
  const run: ChatRun = {
    key,
    projectId,
    userId,
    uiMessages: [...history.uiMessages],
    modelMessages: [...history.modelMessages],
    liveAssistantMessage: null,
    subscribers: new Set(),
    pendingTurns: [],
    isStreaming: false,
    revision: history.revision,
    cleanupTimer: null,
    autoContinuedLastUserId: null,
  };
  runs.set(key, run);
  return run;
}

function scheduleCleanup(run: ChatRun) {
  if (run.isStreaming || run.pendingTurns.length > 0 || run.subscribers.size > 0) return;
  if (run.cleanupTimer) clearTimeout(run.cleanupTimer);
  run.cleanupTimer = setTimeout(() => {
    const current = runs.get(run.key);
    if (current && !current.isStreaming && current.pendingTurns.length === 0 && current.subscribers.size === 0) {
      runs.delete(run.key);
    }
  }, RUN_IDLE_TTL_MS);
}

function broadcast(run: ChatRun, event: string, data: unknown) {
  for (const subscriber of run.subscribers) {
    subscriber.send(event, data);
  }
}

function maybeContinueLastUser(run: ChatRun) {
  if (run.isStreaming || run.pendingTurns.length > 0) return;
  const last = run.uiMessages[run.uiMessages.length - 1];
  if (last?.role !== 'user' || !last.id || run.autoContinuedLastUserId === last.id) return;
  run.autoContinuedLastUserId = last.id;
  run.pendingTurns.push({ userMessageId: last.id, outlineEdited: false, modelAlreadyAppended: true });
  void drainTurns(run).catch((error) => {
    console.error('[project-chat] auto-continue failed:', error);
    run.liveAssistantMessage = null;
    run.isStreaming = false;
    broadcast(run, 'error', { message: '生成失败，请重试。', revision: run.revision });
    scheduleCleanup(run);
  });
}

async function saveHistory(run: ChatRun) {
  const nextHistory: ChatHistory = {
    version: 1,
    revision: run.revision,
    uiMessages: run.uiMessages,
    modelMessages: run.modelMessages,
  };
  await db
    .update(projects)
    .set({ chatHistory: nextHistory, updatedAt: new Date() })
    .where(and(eq(projects.id, run.projectId), eq(projects.userId, run.userId)));
}

async function drainTurns(run: ChatRun) {
  if (run.isStreaming) return;
  run.isStreaming = true;
  try {
    while (run.pendingTurns.length > 0) {
      const turn = run.pendingTurns.shift();
      if (!turn) continue;
      const latestUserId = turn.userMessageId;
      const latestUserMessage = run.uiMessages.find((message) => message.id === latestUserId && message.role === 'user');
      if (!latestUserMessage) continue;

      const assistantMessageId = crypto.randomUUID();
      let latestAssistant: any = {
        id: assistantMessageId,
        role: 'assistant',
        parts: [],
      };
      run.uiMessages = insertOrReplaceAfterMessage(run.uiMessages, latestUserId, {
        ...latestAssistant,
      });
      run.liveAssistantMessage = latestAssistant;
      broadcast(run, 'stream', { message: latestAssistant, revision: run.revision });
      const outlineWasEdited = turn.outlineEdited;
      let finalResponseMessages: any[] = [];
      const result = await buildChatStream({
        user: { id: run.userId, email: '' },
        projectId: run.projectId,
        messages: [latestUserMessage as UIMessage],
        historyMessages: run.modelMessages,
        extraSystemReminder: outlineWasEdited ? OUTLINE_EDITED_REMINDER : undefined,
        onFinish: ({ response }) => {
          finalResponseMessages = response.messages ?? [];
        },
      });

      run.liveAssistantMessage = latestAssistant;
      let lastBroadcastAt = 0;
      let lastBroadcastJson = '';

      try {
        const uiStream = result.toUIMessageStream({
          generateMessageId: () => assistantMessageId,
        } as any);
        for await (const message of readUIMessageStream({ stream: uiStream } as any)) {
          latestAssistant = { ...message, id: assistantMessageId, role: 'assistant' };
          run.liveAssistantMessage = latestAssistant;
          run.uiMessages = insertOrReplaceAfterMessage(run.uiMessages, latestUserId, latestAssistant);
          const now = Date.now();
          const json = JSON.stringify(latestAssistant);
          if (now - lastBroadcastAt >= STREAM_BROADCAST_MS && json !== lastBroadcastJson) {
            lastBroadcastAt = now;
            lastBroadcastJson = json;
            broadcast(run, 'stream', { message: latestAssistant, revision: run.revision });
          }
        }
      } catch (error) {
        console.error('[project-chat] stream failed:', error);
        latestAssistant = uiTextMessage('assistant', '生成失败，请重试。');
      }

      latestAssistant = { ...latestAssistant, id: assistantMessageId, role: 'assistant' };
      run.liveAssistantMessage = null;
      run.uiMessages = insertOrReplaceAfterMessage(run.uiMessages, latestUserId, latestAssistant);
      if (!turn.modelAlreadyAppended) {
        run.modelMessages.push(modelTextMessage('user', textFromMessage(latestUserMessage)));
      }
      run.modelMessages.push(...finalResponseMessages);
      if (finalResponseMessages.length === 0) {
        const fallbackText = textFromMessage(latestAssistant);
        if (fallbackText) run.modelMessages.push(modelTextMessage('assistant', fallbackText));
      }
      run.revision += 1;
      await saveHistory(run);
      broadcast(run, 'done', {
        message: latestAssistant,
        revision: run.revision,
        sideEffects: { toolTypes: toolTypesFrom(latestAssistant) },
      });
    }
  } finally {
    run.isStreaming = false;
    scheduleCleanup(run);
  }
}

const app = new Hono();

app.use('*', requireAuth);

app.get('/:id/chat/events', async (c) => {
  const user = c.get('user');
  const projectId = c.req.param('id');
  const t0 = Date.now();
  console.info(`[chat-events] start project=${projectId} user=${user.id}`);
  const project = await loadOwnedProject(projectId, user.id);
  console.info(`[chat-events] owner-check project=${projectId} ms=${Date.now() - t0} found=${!!project}`);
  if (!project) return c.json({ error: 'Not found' }, 404);

  return streamSSE(c, async (stream) => {
    const streamStart = Date.now();
    const run = await getOrCreateRun(projectId, user.id);
    if (!run) {
      await stream.writeSSE({ event: 'error', data: JSON.stringify({ message: '项目不存在' }) });
      return;
    }
    console.info(`[chat-events] run-ready project=${projectId} ms=${Date.now() - streamStart} total=${Date.now() - t0} messages=${run.uiMessages.length} streaming=${run.isStreaming}`);

    let chain = Promise.resolve();
    const subscriber: Subscriber = {
      send: (event, data) => {
        chain = chain
          .then(() => stream.writeSSE({ event, data: JSON.stringify(data) }))
          .catch(() => undefined);
      },
    };
    run.subscribers.add(subscriber);

    const snapshotMessages = visibleChatMessages(run.uiMessages);
    const snapshotStart = Date.now();
    await stream.writeSSE({
      event: 'snapshot',
      data: JSON.stringify({
        messages: snapshotMessages,
        status: run.isStreaming ? 'streaming' : 'ready',
        revision: run.revision,
      }),
    });
    console.info(`[chat-events] snapshot-written project=${projectId} ms=${Date.now() - snapshotStart} total=${Date.now() - t0} visible=${snapshotMessages.length}`);

    maybeContinueLastUser(run);

    stream.onAbort(() => {
      run.subscribers.delete(subscriber);
      console.info(`[chat-events] abort project=${projectId} total=${Date.now() - t0} subscribers=${run.subscribers.size}`);
      scheduleCleanup(run);
    });

    while (!stream.aborted) {
      await stream.sleep(15_000);
      if (!stream.aborted) await stream.writeSSE({ event: 'heartbeat', data: '{}' });
    }
  });
});

app.post('/:id/chat/messages', async (c) => {
  const user = c.get('user');
  const projectId = c.req.param('id');
  const t0 = Date.now();
  console.info(`[chat-post] start project=${projectId} user=${user.id}`);
  const body = await c.req.json().catch(() => ({}));
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (!text) return c.json({ error: 'text is required' }, 400);

  const run = await getOrCreateRun(projectId, user.id);
  console.info(`[chat-post] run-ready project=${projectId} ms=${Date.now() - t0} found=${!!run}`);
  if (!run) return c.json({ error: 'Not found' }, 404);

  const outlineEdited = body?.outlineEditedSinceLastChat === true;
  if (outlineEdited) {
    run.uiMessages.push(uiTextMessage('system', OUTLINE_EDITED_REMINDER, {
      hidden: true,
      kind: 'outline-reminder',
    }));
  }

  const userMessage = uiTextMessage('user', text);
  run.uiMessages.push(userMessage);
  run.pendingTurns.push({ userMessageId: userMessage.id, outlineEdited, modelAlreadyAppended: false });
  broadcast(run, 'message', { message: userMessage, revision: run.revision });
  void drainTurns(run).catch((error) => {
    console.error('[project-chat] run failed:', error);
    run.liveAssistantMessage = null;
    run.isStreaming = false;
    broadcast(run, 'error', { message: '生成失败，请重试。', revision: run.revision });
    scheduleCleanup(run);
  });

  console.info(`[chat-post] accepted project=${projectId} ms=${Date.now() - t0} pending=${run.pendingTurns.length}`);
  return c.json({ ok: true, userMessageId: userMessage.id }, 202);
});

export default app;
