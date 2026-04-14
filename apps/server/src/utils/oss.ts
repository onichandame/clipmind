import OSS from 'ali-oss';

export const ossClient = new OSS({
  region: process.env.ALIYUN_OSS_REGION || '',
  accessKeyId: process.env.ALIYUN_ACCESS_KEY_ID || '',
  accessKeySecret: process.env.ALIYUN_ACCESS_KEY_SECRET || '',
  bucket: process.env.ALIYUN_OSS_BUCKET || '',
});
