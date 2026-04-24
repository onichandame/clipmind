import { assets } from "@clipmind/db";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { serverConfig } from "../env";
// @ts-ignore
import Core from '@alicloud/pop-core';
import { signAssetViewUrl } from "./oss";

/**
 * 提交阿里云录音文件识别任务 (FileTrans)
 * @param assetId 本地资产 ID
 * @param audioOssUrl 需要识别的音频公网/预签名 URL
 */
export async function submitAliyunAsrTask(assetId: string, audioOssUrl: string) {
  console.log("\n------------------------------------------");
  console.log(`[DEBUG: Aliyun-ASR] 1. submitAliyunAsrTask 被调用`);
  console.log(`[DEBUG: Aliyun-ASR] 接收参数 - assetId: ${assetId}, audioOssUrl: ${audioOssUrl}`);
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
      endpoint: 'https://filetrans.cn-shenzhen.aliyuncs.com',
      apiVersion: '2018-08-17'
    });

    // 核心修复：自动签发具有时效性的公网可达 URL (HTTPS, 2 小时有效)
    const signedAudioUrl = signAssetViewUrl(audioOssUrl);
    if (!signedAudioUrl) {
      throw new Error(`无法为 AssetID=${assetId} 签发音频 URL: 入参为空`);
    }
    console.log(`[DEBUG: Aliyun-ASR] 1.5. 成功签发 OSS 临时访问链接: ${signedAudioUrl.split('?')[0]}?Expires=...`);

    const task = {
      appkey: appKey,
      file_link: signedAudioUrl,
      version: "4.0",
      enable_words: false,
      enable_callback: true,
      callback_url: `${serverConfig.PUBLIC_WEBHOOK_DOMAIN}/api/asr-callback`
    };

    console.log(`[DEBUG: Aliyun-ASR] 2. 组装的发往阿里云的 Task Payload:`, JSON.stringify(task));

    const response: any = await client.request(
      'SubmitTask',
      { Task: JSON.stringify(task) },
      { method: 'POST' }
    );

    console.log(`[DEBUG: Aliyun-ASR] 3. 阿里云返回的原始 Response:`, JSON.stringify(response));

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
