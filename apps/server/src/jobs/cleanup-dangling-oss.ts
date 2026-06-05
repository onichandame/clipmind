import cron from 'node-cron';
import { ossClient } from '../utils/oss';
import { db } from '../db';
import { mediaFiles, projectAssets } from '@clipmind/db/schema';
import { or, eq } from 'drizzle-orm';

const TEMP_IMPORT_TTL_MS = 2 * 60 * 60 * 1000;
const UNREFERENCED_ASSET_GRACE_MS = 24 * 60 * 60 * 1000;

function isExpiredTempObject(obj: { name: string; lastModified?: string | Date }) {
  if (!obj.name.startsWith('assets/tmp/import/')) return false;
  const modified = obj.lastModified ? new Date(obj.lastModified).getTime() : 0;
  return !modified || Date.now() - modified > TEMP_IMPORT_TTL_MS;
}

function isPastUnreferencedGrace(obj: { lastModified?: string | Date }) {
  const modified = obj.lastModified ? new Date(obj.lastModified).getTime() : 0;
  return !!modified && Date.now() - modified > UNREFERENCED_ASSET_GRACE_MS;
}

async function isCurrentlyReferencedObject(objectKey: string) {
  const [exactMediaRef] = await db
    .select({ id: mediaFiles.id })
    .from(mediaFiles)
    .where(or(
      eq(mediaFiles.audioOssKey, objectKey),
      eq(mediaFiles.thumbnailOssKey, objectKey),
      eq(mediaFiles.videoOssKey, objectKey),
    ))
    .limit(1);
  if (exactMediaRef) return true;

  const parts = objectKey.split('/');
  const id = parts.length > 1 ? parts[1] : null;
  if (!id || id === 'by-hash' || id === 'tmp') return false;

  const [[mf], [pa]] = await Promise.all([
    db.select({ id: mediaFiles.id }).from(mediaFiles).where(eq(mediaFiles.id, id)).limit(1),
    db.select({ id: projectAssets.id }).from(projectAssets).where(eq(projectAssets.id, id)).limit(1),
  ]);
  return !!mf || !!pa;
}

export function startDanglingOssCleanupJob() {
  const runCleanup = async () => {
    console.log('🧹 [Cron] 启动 OSS 幽灵资产清理任务...');
    try {
      // Build valid ID/key sets from both tables. Global video backups live under
      // assets/by-hash/<sha> and must be preserved by exact DB reference, not by
      // the second path segment being a media/project id.
      const [mfRows, paRows] = await Promise.all([
        db.select({
          id: mediaFiles.id,
          audioOssKey: mediaFiles.audioOssKey,
          thumbnailOssKey: mediaFiles.thumbnailOssKey,
          videoOssKey: mediaFiles.videoOssKey,
        }).from(mediaFiles),
        db.select({ id: projectAssets.id }).from(projectAssets),
      ]);

      const validIds = new Set([
        ...mfRows.map(r => r.id),
        ...paRows.map(r => r.id),
      ]);
      const referencedKeys = new Set(
        mfRows.flatMap(r => [r.audioOssKey, r.thumbnailOssKey, r.videoOssKey]).filter(Boolean) as string[],
      );

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
            if (obj.name.startsWith('assets/tmp/')) {
              if (isExpiredTempObject(obj)) {
                console.log(`🗑️ [Cron] 清理过期临时导入对象: ${obj.name}`);
                await ossClient.delete(obj.name);
                deletedCount++;
              }
              continue;
            }
            if (referencedKeys.has(obj.name)) continue;
            if (!isPastUnreferencedGrace(obj)) continue;

            const parts = obj.name.split('/');
            const id = parts.length > 1 ? parts[1] : null;

            if (!id || !validIds.has(id)) {
              if (await isCurrentlyReferencedObject(obj.name)) continue;
              const latest = await ossClient.head(obj.name).catch(() => null) as any;
              const latestLastModified = latest?.res?.headers?.['last-modified'];
              if (!latest || !isPastUnreferencedGrace({ lastModified: latestLastModified })) continue;
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
