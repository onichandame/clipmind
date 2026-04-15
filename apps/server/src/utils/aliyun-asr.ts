import { assets } from "@clipmind/db";
import { eq } from "drizzle-orm";
import { db } from "../db";

/**
 * 提交阿里云录音文件识别任务 (FileTrans)
 * @param assetId 本地资产 ID
 * @param audioOssUrl 需要识别的音频公网/预签名 URL
 */
export async function submitAliyunAsrTask(assetId: string, audioOssUrl: string) {
  // 架构师红线：此处依赖阿里云鉴权，实际项目中须在 env 中配置 AK/SK
  const appKey = process.env.ALIYUN_ASR_APPKEY;
  if (!appKey) {
    console.warn("⚠️ 缺少 ALIYUN_ASR_APPKEY，跳过 ASR 任务提交");
    return;
  }

  console.log(`🚀 [ASR Pipeline] 正在向阿里云提交识别任务, AssetID: ${assetId}`);

  try {
    // TODO: 替换为真实的 @alicloud/pop-core 客户端调用
    // const response = await client.request('SubmitTask', { ... });
    const mockTaskId = `aliyun_task_${Date.now()}`;

    // 更新状态机：标记为处理中
    await db.update(assets)
      .set({ asrTaskId: mockTaskId, asrStatus: 'processing' })
      .where(eq(assets.id, assetId));

    console.log(`✅ [ASR Pipeline] 任务提交成功, TaskId: ${mockTaskId}`);
  } catch (error) {
    await db.update(assets).set({ asrStatus: 'failed' }).where(eq(assets.id, assetId));
    console.error(`❌ [ASR Pipeline] 任务提交失败:`, error);
  }
}
