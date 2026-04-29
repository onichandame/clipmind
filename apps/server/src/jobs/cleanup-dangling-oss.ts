import cron from 'node-cron';
import { ossClient } from '../utils/oss';
import { db } from '../db';
import { mediaFiles, projectAssets } from '@clipmind/db/schema';

export function startDanglingOssCleanupJob() {
  const runCleanup = async () => {
    console.log('🧹 [Cron] 启动 OSS 幽灵资产清理任务...');
    try {
      // Build valid ID sets from both tables
      const [mfRows, paRows] = await Promise.all([
        db.select({ id: mediaFiles.id }).from(mediaFiles),
        db.select({ id: projectAssets.id }).from(projectAssets),
      ]);

      const validIds = new Set([
        ...mfRows.map(r => r.id),
        ...paRows.map(r => r.id),
      ]);

      let marker: string | undefined = undefined;
      let deletedCount = 0;

      do {
        const result = await ossClient.list({
          prefix: 'assets/',
          marker,
          'max-keys': 100
        }, {});

        marker = result.nextMarker;

        if (result.objects && result.objects.length > 0) {
          for (const obj of result.objects) {
            if (obj.name === 'assets/') continue;

            const parts = obj.name.split('/');
            const id = parts.length > 1 ? parts[1] : null;

            if (!id || !validIds.has(id)) {
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

  runCleanup();
  cron.schedule('0 3 * * *', runCleanup);
  console.log('⏰ [Cron] OSS 幽灵资产清理防线已挂载 (启动即检 + 每天 03:00 巡检).');
}
