import cron from 'node-cron';
import { generateText } from 'ai';
import { and, eq, isNotNull, lt, sql } from 'drizzle-orm';
import { db } from '../db';
import { users } from '@clipmind/db/schema';
import { createAIModel } from '../utils/ai';

// Compact a single user's memory blob: collapse duplicates / drop stale entries.
// Returns true iff the column was overwritten (achieved >=5% size reduction).
async function compactOne(userId: string, current: string): Promise<boolean> {
  const prompt =
    `下面是一份 AI 助手对某用户的长期记忆 markdown，可能含有重复条目、过期事实、矛盾陈述、零碎片段。\n` +
    `请在**保留所有真实事实**的前提下重写为更紧凑的版本，目标 ≤ 6KB。\n` +
    `规则：\n` +
    `- 合并同类项（同一偏好被记录两次只保留一条）。\n` +
    `- 删去明显矛盾或过期的条目（用户后说覆盖前说）。\n` +
    `- 保持 \`##\` 章节结构（## 身份 / ## 创作偏好 / ## 工作流偏好 / ## 反馈，按需取舍）。\n` +
    `- 不要新增任何"猜测"。只能精炼或删除。\n` +
    `- 直接输出新版 markdown，不要任何前后缀解释。\n\n` +
    `<current>\n${current}\n</current>`;

  let newMd: string;
  try {
    const result = await generateText({ model: createAIModel(), prompt });
    newMd = result.text.trim();
  } catch (e) {
    console.error(`[MemoryCompaction] LLM 调用失败 user=${userId}:`, e);
    return false;
  }

  if (!newMd) {
    console.warn(`[MemoryCompaction] LLM 返回空内容，跳过 user=${userId}`);
    return false;
  }

  if (newMd.length >= current.length * 0.95) {
    console.log(`[MemoryCompaction] 压缩收益不足 (${current.length} → ${newMd.length})，跳过 user=${userId}`);
    return false;
  }

  await db.update(users)
    .set({ memoryMd: newMd, memoryUpdatedAt: new Date() })
    .where(eq(users.id, userId));
  console.log(`[MemoryCompaction] ✅ user=${userId} ${current.length} → ${newMd.length} bytes`);
  return true;
}

export async function runMemoryCompaction(): Promise<{ scanned: number; compacted: number }> {
  const cutoff = new Date(Date.now() - 12 * 3600 * 1000);

  const candidates = await db
    .select({ id: users.id, md: users.memoryMd })
    .from(users)
    .where(and(
      isNotNull(users.memoryMd),
      sql`CHAR_LENGTH(${users.memoryMd}) >= 4000`,
      lt(users.memoryUpdatedAt, cutoff),
    ));

  console.log(`[MemoryCompaction] 扫描到 ${candidates.length} 个候选用户`);
  let compacted = 0;
  for (const row of candidates) {
    if (!row.md) continue;
    const ok = await compactOne(row.id, row.md);
    if (ok) compacted++;
  }
  console.log(`[MemoryCompaction] 完成：扫描 ${candidates.length}，实际压缩 ${compacted}`);
  return { scanned: candidates.length, compacted };
}

let isRunning = false;

export function startMemoryCompactionJob(): void {
  cron.schedule('0 3 * * *', () => {
    if (isRunning) {
      console.warn('[MemoryCompaction] 上一轮尚未结束，跳过本次触发');
      return;
    }
    isRunning = true;
    runMemoryCompaction()
      .catch(e => console.error('[MemoryCompaction] 定时任务失败:', e))
      .finally(() => { isRunning = false; });
  });
  console.log('[MemoryCompaction] 定时任务已注册：每天 03:00');
}
