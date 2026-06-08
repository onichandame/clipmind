import { useCallback, useEffect, useRef, useState } from 'react';
import { env } from '../env';
import { authFetch, authHeaders } from './auth';
import { parseSseFrames, upsertMessage } from './chat-sse';

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
    if (event === 'error') {
      setStatus('error');
      setError(typeof payload.message === 'string' ? payload.message : '生成失败，请重试。');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | undefined;

    const connect = async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setStatus((current) => (current === 'streaming' ? current : 'connecting'));
      try {
        const res = await fetch(`${env.VITE_API_BASE_URL}/api/projects/${projectId}/chat/events`, {
          headers: authHeaders(),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) throw new Error(`SSE failed (${res.status})`);
        retryRef.current = 0;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (!cancelled) {
          const { done, value } = await reader.read();
          if (done) throw new Error('SSE stream closed');
          buffer += decoder.decode(value, { stream: true });
          const parsed = parseSseFrames(buffer);
          buffer = parsed.rest;
          for (const item of parsed.events) applyEvent(item.event, item.data);
        }
      } catch (err: any) {
        if (cancelled || controller.signal.aborted) return;
        setStatus('error');
        setError('连接已断开，正在重连…');
        const attempt = Math.min(retryRef.current + 1, 5);
        retryRef.current = attempt;
        retryTimer = window.setTimeout(connect, 500 * attempt);
      }
    };

    connect();
    return () => {
      cancelled = true;
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
