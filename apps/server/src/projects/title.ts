import { generateObject } from 'ai';
import { z } from 'zod';
import { createAIModel } from '../utils/ai';

const TITLE_MAX_LENGTH = 24;

export const ProjectTitleSchema = z.object({
  title: z.string().min(1).max(40),
});

export function workflowModeLabel(workflowMode: string | null | undefined) {
  if (workflowMode === 'material') return '素材驱动的视频剪辑项目';
  if (workflowMode === 'idea') return '灵感探索与选题策划项目';
  if (workflowMode === 'freechat') return '自由对话项目';
  return '视频创作项目';
}

export function buildProjectTitlePrompt(firstUserMessage: string, workflowMode: string | null | undefined) {
  return `你是一个产品里的会话标题生成器。请根据用户发出的第一条消息，为这个项目拟定一个短标题。

项目类型：${workflowModeLabel(workflowMode)}

要求：
- 使用中文，除非用户消息主体是英文
- 2 到 ${TITLE_MAX_LENGTH} 个字符
- 直接概括用户意图或创作主题
- 不要使用“未命名”“新项目”“对话”等占位词
- 不要引号、emoji、句号、冒号或 Markdown
- 只返回 JSON，不要解释

用户第一条消息：
${firstUserMessage}`;
}

export function sanitizeProjectTitle(input: string) {
  const trimmed = input
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/^[\s"'“”‘’《<【\[]+|[\s"'“”‘’》>】\].。！？!?:：]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!trimmed) return null;
  return Array.from(trimmed).slice(0, TITLE_MAX_LENGTH).join('');
}

export async function generateProjectTitleFromFirstMessage({
  firstUserMessage,
  workflowMode,
}: {
  firstUserMessage: string;
  workflowMode: string | null | undefined;
}) {
  const { object } = await generateObject({
    model: createAIModel(),
    schema: ProjectTitleSchema,
    prompt: buildProjectTitlePrompt(firstUserMessage, workflowMode),
  });
  return sanitizeProjectTitle(object.title);
}
