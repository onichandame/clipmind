import cron from 'node-cron';
import { updateHotTopicsCache } from '../utils/hot-topics';

export const fetchHotTopics = async () => {
    try {
        console.log('[Job] 开始抓取全网热点...');
        let topicsMarkdown = '## 🔥 今日全网热点风向标\n\n';

        // 1. 百度热搜 (移动端 JSON API) - 当前唯一稳定免鉴权源
        try {
            const baiduRes = await fetch('https://top.baidu.com/api/board?platform=wise&tab=realtime', {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15',
                    'Host': 'top.baidu.com'
                }
            });
            if (baiduRes.ok) {
                const data = await baiduRes.json() as any;
                topicsMarkdown += '### 🟥 百度热搜 (Top 10)\n';
                // 仅提取纯文本 word，舍弃冗余 UI 数据，降低 LLM Token 消耗
                data.data?.cards?.[0]?.content?.slice(0, 10).forEach((item: any, index: number) => {
                    topicsMarkdown += `${index + 1}. ${item.word || '未知热词'}\n`;
                });
                topicsMarkdown += '\n';
            }
        } catch (e) { console.error('[Job] 百度抓取失败:', e); }

        updateHotTopicsCache(topicsMarkdown);
        console.log('[Job] 聚合后的热点内容:\n', topicsMarkdown);
        console.log('[Job] 全网热点更新完毕。');
    } catch (error) {
        console.error('[Job] fetchHotTopics 发生致命错误:', error);
    }
};

export const startHotTopicsJob = () => {
    // 启动时立即执行一次，防止冷启动时无数据
    fetchHotTopics();
    // 每天凌晨 04:00 定时执行
    cron.schedule('0 4 * * *', fetchHotTopics);
};
