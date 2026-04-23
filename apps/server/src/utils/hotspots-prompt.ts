export function buildHotspotsPrompt(corpusMarkdown: string, existingCategories: string[]): string {
  const categoriesHint = existingCategories.length > 0
    ? `【已有分类参考】（优先复用下列分类标签；若新热点确实无法归入，可创建新分类，但需言之有物）：\n${existingCategories.join('、')}\n\n`
    : '';

  return `你是一个中文社媒趋势分析师。基于下方抓取到的原始资料（来自小红书、微信公众号/视频号、抖音、B站），提炼出目前最具传播潜力的独立热点话题。

${categoriesHint}【输出要求】
1. title：一句话概括，不超过 30 字，不含 "#"、引号、emoji
2. description：1-3 句，说明热点是什么、为什么火，不含平台隐性推销语
3. category：2-8 字中文名词性短语，如"美妆教程"、"职场吐槽"；优先复用参考列表中的分类
4. source：热度命中最强的那个平台；若跨平台，用 "mixed"；只能是 xiaohongshu / wechat / douyin / bilibili / mixed 之一
5. sourceUrls：2-5 个最有代表性的原始链接（从原始资料里选）
6. heatMetric：口语化热度描述，必须含一个数字维度 + 一个趋势维度，如 "8.5万讨论 / 本周+120%"
7. heatScore：0-100 整数，综合传播潜力打分，用于排序
8. rationale：一句话说明你为什么认为这是热点（内部用，不展示给用户）
9. 去重：同一话题只留一条，合并多个来源到 sourceUrls
10. 按 heatScore 降序输出

【原始资料】
${corpusMarkdown}`;
}
