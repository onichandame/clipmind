import { useCallback, useEffect, useRef, useState } from 'react';
import { env } from '../env';
import { authFetch } from './auth';
import { upsertMessage } from './chat-sse';

type ChatStatus = 'connecting' | 'ready' | 'submitting' | 'streaming' | 'error';

export function useProjectChat(projectId: string) {
  const [messages, setMessages] = useState<any[]>([]);
  const [status, setStatus] = useState<ChatStatus>('connecting');
  const [error, setError] = useState<string | null>(null);
  const retryRef = useRef(0);
  const eventSourceRef = useRef<EventSource | null>(null);

  const applyEvent = useCallback((event: string, raw: string) => {
    if (event === 'heartbeat') return;
    let payload: any = {};
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      return;
    }
    if (event === 'snapshot') {
      setMessages(Array.isArray(payload.messages) ? payload.messages : []);
      setStatus(payload.status === 'streaming' ? 'streaming' : 'ready');
      setError(null);
      return;
    }
    if (event === 'message') {
      if (payload.message) setMessages((current) => upsertMessage(current, payload.message));
      setStatus('streaming');
      return;
    }
    if (event === 'stream') {
      if (payload.message) setMessages((current) => upsertMessage(current, payload.message));
      setStatus('streaming');
      return;
    }
    if (event === 'done') {
      if (payload.message) setMessages((current) => upsertMessage(current, payload.message));
      setStatus('ready');
      setError(null);
      return;
    }
    if (event === 'chat-error') {
      setStatus('error');
      setError(typeof payload.message === 'string' ? payload.message : '生成失败，请重试。');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | undefined;
    let connectTimer: number | undefined;

    const connect = () => {
      eventSourceRef.current?.close();
      const startedAt = performance.now();
      console.info(`[chat-sse] connect start project=${projectId}`);
      setStatus((current) => (current === 'streaming' ? current : 'connecting'));
      const source = new EventSource(`${env.VITE_API_BASE_URL}/api/projects/${projectId}/chat/events`, {
        withCredentials: true,
      });
      eventSourceRef.current = source;

      source.onopen = () => {
        retryRef.current = 0;
        console.info(`[chat-sse] response project=${projectId} status=200 ms=${Math.round(performance.now() - startedAt)}`);
      };

      source.onerror = async () => {
        source.close();
        if (cancelled) return;
        const sessionStatus = await authFetch(`${env.VITE_API_BASE_URL}/api/auth/me`).then((res) => res.status).catch(() => 0);
        if (cancelled) return;
        if (sessionStatus === 401) {
          setStatus('error');
          setError('登录已过期，请重新登录。');
          return;
        }
        console.info(`[chat-sse] reconnect project=${projectId} ms=${Math.round(performance.now() - startedAt)} reason=SSE stream closed`);
        setStatus('error');
        setError('连接已断开，正在重连…');
        if (retryRef.current >= 5) {
          setError('连接失败，请刷新后重试。');
          return;
        }
        const attempt = retryRef.current + 1;
        retryRef.current = attempt;
        retryTimer = window.setTimeout(connect, 500 * attempt);
      };

      for (const eventName of ['snapshot', 'message', 'stream', 'done', 'chat-error', 'heartbeat']) {
        source.addEventListener(eventName, (event) => {
          if (eventName === 'snapshot') {
            console.info(`[chat-sse] snapshot project=${projectId} ms=${Math.round(performance.now() - startedAt)}`);
          }
          applyEvent(eventName, (event as MessageEvent).data ?? '');
        });
      }
    };

    // React dev/StrictMode mounts effects twice. Deferring the actual network
    // request lets the first throwaway mount clean up before it opens a long
    // lived SSE connection that can block the real one behind browser/proxy
    // connection limits.
    connectTimer = window.setTimeout(connect, 0);
    return () => {
      cancelled = true;
      if (connectTimer) window.clearTimeout(connectTimer);
      if (retryTimer) window.clearTimeout(retryTimer);
      eventSourceRef.current?.close();
    };
  }, [projectId, applyEvent]);

  const sendMessage = useCallback(async (text: string, options?: { outlineEditedSinceLastChat?: boolean }) => {
    const content = text.trim();
    if (!content) return;
    setStatus('submitting');
    const res = await authFetch(`${env.VITE_API_BASE_URL}/api/projects/${projectId}/chat/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: content, outlineEditedSinceLastChat: options?.outlineEditedSinceLastChat === true }),
    });
    if (!res.ok) {
      setStatus('error');
      setError('发送失败，请稍后重试。');
      throw new Error('Failed to send message');
    }
  }, [projectId]);

  return { messages, status, error, sendMessage };
}

export function isToolPart(part: any) {
  return typeof part?.type === 'string' && part.type.startsWith('tool-');
}
