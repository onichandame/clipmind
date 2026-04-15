import { assets } from "@clipmind/db";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { serverConfig } from "../env";
// @ts-ignore
import Core from '@alicloud/pop-core';

/**
 * 提交阿里云录音文件识别任务 (FileTrans)
 * @param assetId 本地资产 ID
 * @param audioOssUrl 需要识别的音频公网/预签名 URL
 */
export async function submitAliyunAsrTask(assetId: string, audioOssUrl: string) {
  // 架构师红线：此处依赖阿里云鉴权，实际项目中须在 env 中配置 AK/SK
  const appKey = serverConfig.ALIYUN_ASR_APPKEY;
  if (!appKey) {
    console.warn("⚠️ 缺少 ALIYUN_ASR_APPKEY，跳过 ASR 任务提交");
    return;
  }

  console.log(`🚀 [ASR Pipeline] 正在向阿里云提交识别任务, AssetID: ${assetId}`);

  try {
    const client = new Core({
      accessKeyId: serverConfig.ALIYUN_ACCESS_KEY_ID,
      accessKeySecret: serverConfig.ALIYUN_ACCESS_KEY_SECRET,
      endpoint: 'https://filetrans.cn-shanghai.aliyuncs.com',
      apiVersion: '2018-08-17'
    });

    const task = {
      appkey: appKey,
      file_link: audioOssUrl,
      version: "4.0",
      enable_words: false,
      enable_callback: true,
      callback_url: `${serverConfig.PUBLIC_WEBHOOK_DOMAIN}/api/asr-callback`
    };

    const response: any = await client.request(
      'SubmitTask',
      { Task: JSON.stringify(task) },
      { method: 'POST' }
    );

    if (response.StatusText !== 'SUCCESS') {
      throw new Error(`Aliyun Reject: ${response.StatusText}`);
    }

    const taskId = response.TaskId;

    // 更新状态机：标记为处理中，记录真实的任务 ID
    await db.update(assets)
      .set({ asrTaskId: taskId, asrStatus: 'processing' })
      .where(eq(assets.id, assetId));

    console.log(`✅ [ASR Pipeline] 任务提交成功, 真实 TaskId: ${taskId}`);
  } catch (error) {
    await db.update(assets).set({ asrStatus: 'failed' }).where(eq(assets.id, assetId));
    console.error(`❌ [ASR Pipeline] 任务提交失败:`, error);
  }
}
