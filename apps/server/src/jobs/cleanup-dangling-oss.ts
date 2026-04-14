import cron from 'node-cron';
import { ossClient } from '../utils/oss';
import { db } from '../db';
import { assets } from '@clipmind/db/schema';

export function startDanglingOssCleanupJob() {
  const runCleanup = async () => {
    console.log('🧹 [Cron] 启动 OSS 幽灵资产清理任务...');
    try {
      // 1. 获取数据库中所有合法的 OSS URL
      const allAssets = await db.select({
        ossUrl: assets.ossUrl,
        audioOssUrl: assets.audioOssUrl
      }).from(assets);

      const validKeys = new Set<string>();

      // 工具函数：从绝对 URL 提取纯正的 Object Key
      const extractKey = (urlStr: string | null) => {
        if (!urlStr) return null;
        try {
          const url = new URL(urlStr);
          // 去除前导 '/'，并解码中文路径
          return decodeURIComponent(url.pathname.substring(1));
        } catch (e) {
          return null;
        }
      };

      allAssets.forEach(a => {
        const videoKey = extractKey(a.ossUrl);
        const audioKey = extractKey(a.audioOssUrl);
        if (videoKey) validKeys.add(videoKey);
        if (audioKey) validKeys.add(audioKey);
      });

      // 2. 扫描 OSS 并实施物理比对 (采用游标分页防内存溢出)
      let marker: string | undefined = undefined;
      let deletedCount = 0;

      do {
        // 安全红线：限定仅扫描 assets/ 目录下的文件
        const result = await ossClient.list({
          prefix: 'assets/',
          marker,
          'max-keys': 100
        }, {});

        marker = result.nextMarker;

        if (result.objects && result.objects.length > 0) {
          for (const obj of result.objects) {
            if (!validKeys.has(obj.name)) {
              console.log(`🗑️ [Cron] 发现幽灵资产，执行抹除: ${obj.name}`);
              await ossClient.delete(obj.name);
              deletedCount++;
            }
          }
        }
      } while (marker);

      console.log(`✅ [Cron] OSS 清理完毕，共回收 ${deletedCount} 个幽灵文件。`);
    } catch (error) {
      console.error('❌ [Cron] OSS 清理任务抛出异常:', error);
    }
  };

  // 启动时立即巡检一次（异步非阻塞）
  runCleanup();

  // 每天凌晨 3 点执行
  cron.schedule('0 3 * * *', runCleanup);

  console.log('⏰ [Cron] OSS 幽灵资产清理防线已挂载 (启动即检 + 每天 03:00 巡检).');
}
