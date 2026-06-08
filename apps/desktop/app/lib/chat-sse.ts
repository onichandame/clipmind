export type ChatEvent = {
  event: string;
  data: string;
};

export function upsertMessage(messages: any[], message: any) {
  const index = messages.findIndex((item) => item.id === message.id);
  if (index === -1) return [...messages, message];
  const next = [...messages];
  next[index] = message;
  return next;
}

export function parseSseFrames(buffer: string) {
  const frames = buffer.split(/\n\n/);
  const rest = frames.pop() ?? '';
  const events: ChatEvent[] = [];
  for (const frame of frames) {
    let event = 'message';
    const dataLines: string[] = [];
    for (const line of frame.split(/\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    }
    if (dataLines.length > 0) events.push({ event, data: dataLines.join('\n') });
  }
  return { events, rest };
}
