import { useCallback, useEffect, useRef, useState } from 'react';
import { env } from '../env';
import { authFetch, clearAuthStorage } from './auth';
import { upsertMessage } from './chat-sse';

type ChatStatus = 'connecting' | 'ready' | 'submitting' | 'streaming' | 'error';

export function useProjectChat(projectId: string) {
  const [messages, setMessages] = useState<any[]>([]);
  const [status, setStatus] = useState<ChatStatus>('connecting');
  const [error, setError] = useState<string | null>(null);
  const retryRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

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

    const handleError = async (startedAt: number) => {
      if (cancelled) return;
      const sessionStatus = await authFetch(`${env.VITE_API_BASE_URL}/api/auth/me`).then((res) => res.status).catch(() => 0);
      if (cancelled) return;
      if (sessionStatus === 401) {
        void clearAuthStorage();
        setStatus('error');
        setError('登录已过期，请重新登录。');
        return;
      }
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

    const dispatchFrame = (frame: string, startedAt: number) => {
      let event = 'message';
      const data: string[] = [];
      for (const rawLine of frame.split('\n')) {
        const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
        if (!line || line.startsWith(':')) continue;
        if (line.startsWith('event:')) event = line.slice(6).trimStart();
        if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
      }
      applyEvent(event, data.join('\n'));
    };

    const readStream = async (response: Response, controller: AbortController, startedAt: number) => {
      if (!response.body) throw new Error('SSE response body missing');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        while (!cancelled && !controller.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let boundary = buffer.search(/\r?\n\r?\n/);
          while (boundary !== -1) {
            const frame = buffer.slice(0, boundary);
            const separatorLength = buffer[boundary] === '\r' ? 4 : 2;
            buffer = buffer.slice(boundary + separatorLength);
            dispatchFrame(frame, startedAt);
            boundary = buffer.search(/\r?\n\r?\n/);
          }
        }
        if (!cancelled && !controller.signal.aborted) await handleError(startedAt);
      } finally {
        reader.releaseLock();
      }
    };

    const connect = () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const startedAt = performance.now();
      setStatus((current) => (current === 'streaming' ? current : 'connecting'));
      authFetch(`${env.VITE_API_BASE_URL}/api/projects/${projectId}/chat/events`, {
        headers: { Accept: 'text/event-stream' },
        signal: controller.signal,
      }).then((response) => {
        if (cancelled || controller.signal.aborted) return;
        if (response.status === 401) {
          response.body?.cancel().catch(() => undefined);
          void clearAuthStorage();
          setStatus('error');
          setError('登录已过期，请重新登录。');
          return;
        }
        if (response.status >= 400 && response.status < 500) {
          response.body?.cancel().catch(() => undefined);
          setStatus('error');
          setError(response.status === 404 ? '项目不存在或无权访问。' : '连接被拒绝，请重新登录后重试。');
          return;
        }
        if (!response.ok) {
          response.body?.cancel().catch(() => undefined);
          throw new Error(`SSE failed (${response.status})`);
        }
        retryRef.current = 0;
        return readStream(response, controller, startedAt);
      }).catch((error) => {
        if (cancelled || controller.signal.aborted || error?.name === 'AbortError') return;
        handleError(startedAt);
      });
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
      abortRef.current?.abort();
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
      if (res.status === 401) {
        await clearAuthStorage();
        setError('登录已过期，请重新登录。');
      } else {
        setError('发送失败，请稍后重试。');
      }
      setStatus('error');
      throw new Error('Failed to send message');
    }
  }, [projectId]);

  return { messages, status, error, sendMessage };
}

export function isToolPart(part: any) {
  return typeof part?.type === 'string' && part.type.startsWith('tool-');
}
