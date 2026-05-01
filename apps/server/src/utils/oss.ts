import OSS from 'ali-oss';
import { serverConfig } from '../env';

// 单例 OSS 客户端：强制 HTTPS，所有资产链接均从此处签发
export const ossClient = new OSS({
  region: serverConfig.ALIYUN_OSS_REGION,
  accessKeyId: serverConfig.ALIYUN_ACCESS_KEY_ID,
  accessKeySecret: serverConfig.ALIYUN_ACCESS_KEY_SECRET,
  bucket: serverConfig.ALIYUN_OSS_BUCKET,
  secure: true,
});

const READ_EXPIRES_SECONDS = 7200;    // 读链路：2 小时
const UPLOAD_EXPIRES_SECONDS = 3600;  // 写链路：1 小时

const isAlreadySignedUrl = (value: string) =>
  value.startsWith('http://') || value.startsWith('https://');

/**
 * 将 OSS Object Key 签发为临时只读 URL (HTTPS)。
 * 传入值已是完整 URL 时幂等返回，兼容历史数据。
 */
export function signAssetViewUrl(keyOrUrl: string | null | undefined): string | null {
  if (!keyOrUrl) return null;
  if (isAlreadySignedUrl(keyOrUrl)) return keyOrUrl;
  return ossClient.signatureUrl(keyOrUrl, {
    expires: READ_EXPIRES_SECONDS,
    secure: true,
  });
}

/**
 * 将 OSS Object Key 签发为强制下载 URL，注入 Content-Disposition
 * 绕过浏览器 iframe/沙盒预览拦截。
 */
export function signAssetDownloadUrl(
  keyOrUrl: string | null | undefined,
  filename?: string | null,
): string | null {
  if (!keyOrUrl) return null;
  if (isAlreadySignedUrl(keyOrUrl)) return keyOrUrl;
  const safeFilename = encodeURIComponent(filename || 'clipmind_video.mp4');
  return ossClient.signatureUrl(keyOrUrl, {
    expires: READ_EXPIRES_SECONDS,
    secure: true,
    response: { 'content-disposition': `attachment; filename="${safeFilename}"` },
  });
}

/**
 * 签发前端直传 PUT URL (HTTPS)。明确 Content-Type 防止预签名与请求不一致导致 403。
 */
export function signUploadUrl(objectKey: string, contentType: string): string {
  return ossClient.signatureUrl(objectKey, {
    expires: UPLOAD_EXPIRES_SECONDS,
    method: 'PUT',
    'Content-Type': contentType,
    secure: true,
  });
}

/**
 * 删除 OSS 对象。用于跨用户引用计数归零后清理共享视频备份原片。
 * 不存在的对象返回成功（OSS DELETE 是幂等的）。
 */
export async function deleteAsset(objectKey: string): Promise<void> {
  await ossClient.delete(objectKey);
}
