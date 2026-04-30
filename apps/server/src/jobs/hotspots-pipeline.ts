import cron from 'node-cron';
import { generateObject } from 'ai';
import { z } from 'zod';
import { count, eq, and, ne, lt, sql } from 'drizzle-orm';
import { db } from '../db';
import { hotspots } from '@clipmind/db/schema';
import { googleSearch } from '../utils/searchapi';
import { scrapeWebpage } from '../utils/firecrawl';
import { createAIModel } from '../utils/ai';
import { buildHotspotsPrompt } from '../utils/hotspots-prompt';
import { serverConfig } from '../env';

const ALLOWED_DOMAINS = [
  'xiaohongshu.com',
  'xhslink.com',
  'mp.weixin.qq.com',
  'weixin.qq.com',
  'channels.weixin.qq.com',
  'douyin.com',
  'dy.163.com',
  'bilibili.com',
  'b23.tv',
  // 留学垂直社区（curl 验证可达 + 非 JS 墙）
  '1point3acres.com',
];

function classifyDomain(url: string): 'xiaohongshu' | 'wechat' | 'douyin' | 'bilibili' | 'mixed' {
  if (url.includes('xiaohongshu.com') || url.includes('xhslink.com')) return 'xiaohongshu';
  if (url.includes('weixin.qq.com') || url.includes('channels.weixin')) return 'wechat';
  if (url.includes('douyin.com') || url.includes('dy.163.com')) return 'douyin';
  if (url.includes('bilibili.com') || url.includes('b23.tv')) return 'bilibili';
  return 'mixed';
}

function isAllowedDomain(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return ALLOWED_DOMAINS.some(d => host.endsWith(d));
  } catch {
    return false;
  }
}

function getSeedQueries(): string[] {
  const now = new Date();
  const month = `${now.getFullYear()} 年 ${now.getMonth() + 1} 月`;
  return [
    // 申请季 / 选校（3 条）
    `小红书 留学申请 ${month} 经验贴`,
    `site:xiaohongshu.com 美研选校 25fall OR 26fall`,
    `小红书 英国留学 申请 高赞`,
    // 备考 / 文书（2 条）
    `小红书 雅思 OR 托福 备考 ${month} 高赞`,
    `site:mp.weixin.qq.com 留学文书 OR SOP ${month}`,
    // 海外生活 / 求职（3 条）
    `小红书 留学生 海外生活 ${month}`,
    `site:1point3acres.com 留学 OR 求职 OR OPT 热帖`,
    `bilibili 留学 vlog 热门 ${month}`,
    // 政策 / 签证（1 条）
    `留学签证 OR F-1 OR 工签 政策变动 ${month} site:xiaohongshu.com OR site:mp.weixin.qq.com`,
    // 留学避坑 / 中介（1 条）
    `小红书 留学避坑 OR 留学中介 真实经历`,
    // 跨平台讨论 / 博主（2 条）
    `小红书 留学博主 ${month} 高赞话题`,
    `bilibili 留学 ${month} 排行榜`,
  ];
}

interface CorpusItem {
  url: string;
  title: string;
  snippet: string;
  source: 'xiaohongshu' | 'wechat' | 'douyin' | 'bilibili' | 'mixed';
  markdown: string | null;
}

async function mapConcurrent<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i]);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

async function collectCorpus(): Promise<CorpusItem[]> {
  const queries = getSeedQueries();
  const candidates: Omit<CorpusItem, 'markdown'>[] = [];

  for (const q of queries) {
    try {
      const results = await googleSearch(q, 5);
      for (const r of results) {
        if (isAllowedDomain(r.link)) {
          candidates.push({
            url: r.link,
            title: r.title,
            snippet: r.snippet,
            source: classifyDomain(r.link),
          });
        }
      }
    } catch (e) {
      console.warn('[Hotspots] 搜索失败，跳过:', q, e);
    }
  }

  // 去重 URL
  const seen = new Set<string>();
  const unique = candidates.filter(c => {
    if (seen.has(c.url)) return false;
    seen.add(c.url);
    return true;
  });

  // 并发抓取正文，最多 3 并发
  const withMarkdown = await mapConcurrent(unique, async (c): Promise<CorpusItem> => {
    const markdown = await scrapeWebpage(c.url);
    return { ...c, markdown };
  }, 3);

  // 保留有内容的候选（正文非空，或 snippet 足够长）
  return withMarkdown.filter(c => c.markdown || c.snippet.length >= 60);
}

const HotspotItemSchema = z.object({
  title: z.string().min(4).max(60),
  description: z.string().min(10).max(200),
  category: z.string().min(2).max(20),
  source: z.enum(['xiaohongshu', 'wechat', 'douyin', 'bilibili', 'mixed']),
  sourceUrls: z.array(z.string()).min(1).max(5),
  heatMetric: z.string().min(2).max(50),
  heatScore: z.number().int().min(0).max(100),
  rationale: z.string().max(200).optional(),
});

// 下限放宽到 3：留学场景下原始语料相关性较低，强制 ≥5 会让 LLM 凑数；宁愿少给也不能塞水货。
const PipelineOutputSchema = z.object({
  hotspots: z.array(HotspotItemSchema).min(3).max(serverConfig.HOTSPOTS_MAX_ITEMS),
});

let isRunning = false;

export async function runHotspotsPipeline(): Promise<{ inserted: number; batchId: string }> {
  if (isRunning) {
    console.log('[Hotspots] 管道已在运行中，跳过本次调度');
    return { inserted: 0, batchId: '' };
  }
  isRunning = true;

  try {
    console.log('[Hotspots] 开始抓取热点...');

    const corpus = await collectCorpus();
    console.log(`[Hotspots] 语料收集完毕，共 ${corpus.length} 条`);

    if (corpus.length < serverConfig.HOTSPOTS_MIN_CORPUS) {
      console.error(`[Hotspots] 语料不足 (${corpus.length} < ${serverConfig.HOTSPOTS_MIN_CORPUS})，放弃本次批次`);
      return { inserted: 0, batchId: '' };
    }

    // 查询已有分类，用于收敛 LLM 输出
    const catRows = await db
      .select({ category: hotspots.category, cnt: count() })
      .from(hotspots)
      .where(eq(hotspots.isActive, true))
      .groupBy(hotspots.category)
      .orderBy(sql`count(*) desc`)
      .limit(30);
    const existingCategories = catRows.map(r => r.category);

    // 拼接语料 markdown
    const corpusMarkdown = corpus.map((c, i) =>
      `--- 资料 ${i + 1} (${c.source}) ---\n标题: ${c.title}\n链接: ${c.url}\n${c.markdown ?? c.snippet}`
    ).join('\n\n');

    const prompt = buildHotspotsPrompt(corpusMarkdown, existingCategories);

    console.log('[Hotspots] 调用大模型结构化理解...');
    const model = createAIModel();

    const { object } = await generateObject({
      model,
      schema: PipelineOutputSchema,
      prompt,
    });

    const batchId = crypto.randomUUID();
    const now = new Date();

    await db.transaction(async tx => {
      // 插入新批次
      await tx.insert(hotspots).values(
        object.hotspots.map(item => ({
          id: crypto.randomUUID(),
          batchId,
          isActive: true,
          category: item.category,
          title: item.title,
          description: item.description,
          source: item.source,
          sourceUrls: item.sourceUrls,
          heatMetric: item.heatMetric,
          heatScore: item.heatScore,
          rationale: item.rationale ?? null,
          rawContext: null,
          fetchedAt: now,
          createdAt: now,
        }))
      );

      // 把旧批次置为 inactive
      await tx.update(hotspots)
        .set({ isActive: false })
        .where(and(eq(hotspots.isActive, true), ne(hotspots.batchId, batchId)));
    });

    // 清理 30 天前的历史
    await db.delete(hotspots).where(
      and(
        eq(hotspots.isActive, false),
        lt(hotspots.fetchedAt, sql`DATE_SUB(NOW(), INTERVAL 30 DAY)`)
      )
    );

    console.log(`[Hotspots] 完成，本批次 ${object.hotspots.length} 条，batchId=${batchId}`);
    return { inserted: object.hotspots.length, batchId };
  } catch (error) {
    console.error('[Hotspots] 管道致命错误:', error);
    return { inserted: 0, batchId: '' };
  } finally {
    isRunning = false;
  }
}

export function startHotspotsPipeline(): void {
  if (!serverConfig.SEARCHAPI_KEY || !serverConfig.FIRECRAWL_API_KEY) {
    console.warn('[Hotspots] 缺少 SEARCHAPI_KEY 或 FIRECRAWL_API_KEY，跳过热点管道注册');
    return;
  }

  cron.schedule(serverConfig.HOTSPOTS_CRON_SCHEDULE, () => {
    runHotspotsPipeline().catch(e => console.error('[Hotspots] 定时任务失败:', e));
  });
  console.log(`[Hotspots] 定时任务已注册，计划: ${serverConfig.HOTSPOTS_CRON_SCHEDULE}`);

  // 冷启动兜底：只在无 active 数据时触发
  setImmediate(async () => {
    try {
      const [{ c }] = await db.select({ c: count() }).from(hotspots).where(eq(hotspots.isActive, true));
      if (c === 0) {
        console.log('[Hotspots] 冷启动：无活跃热点，立即拉取');
        runHotspotsPipeline().catch(e => console.error('[Hotspots] 冷启动失败:', e));
      } else {
        console.log(`[Hotspots] 冷启动检查：已有 ${c} 条活跃热点，无需立即拉取`);
      }
    } catch (e) {
      console.error('[Hotspots] 冷启动检查失败:', e);
    }
  });
}
