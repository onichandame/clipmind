export type ChatHistory = {
  version: 1;
  revision: number;
  uiMessages: any[];
  modelMessages: any[];
};

export function normalizeChatHistory(value: unknown): ChatHistory {
  const raw = value as Partial<ChatHistory> | null | undefined;
  return {
    version: 1,
    revision: Number.isFinite(raw?.revision) ? Number(raw?.revision) : 0,
    uiMessages: Array.isArray(raw?.uiMessages) ? raw!.uiMessages! : [],
    modelMessages: Array.isArray(raw?.modelMessages) ? raw!.modelMessages! : [],
  };
}

export function createChatHistory(uiMessages: any[], modelMessages: any[] = []): ChatHistory {
  return { version: 1, revision: 0, uiMessages, modelMessages };
}

export function visibleChatMessages(messages: any[]) {
  return messages.filter((message) => !message?.metadata?.hidden);
}

export function upsertChatMessage(messages: any[], message: any) {
  const index = messages.findIndex((item) => item.id === message.id);
  if (index === -1) return [...messages, message];
  const next = [...messages];
  next[index] = message;
  return next;
}

export function insertOrReplaceAfterMessage(messages: any[], afterMessageId: string, message: any) {
  const existingIndex = messages.findIndex((item) => item.id === message.id);
  if (existingIndex !== -1) {
    const next = [...messages];
    next[existingIndex] = message;
    return next;
  }
  const afterIndex = messages.findIndex((item) => item.id === afterMessageId);
  if (afterIndex === -1) return [...messages, message];
  return [...messages.slice(0, afterIndex + 1), message, ...messages.slice(afterIndex + 1)];
}

export function makeOutlineEditedReminderMessage(id: string) {
  return {
    id,
    role: 'system',
    metadata: { hidden: true, kind: 'outline-reminder' },
    parts: [
      {
        type: 'text',
        text: '<system-reminder>用户刚刚手动修改了右侧大纲。你必须以数据库中的最新大纲为准，不要沿用旧对话里的大纲内容。</system-reminder>',
      },
    ],
  };
}
