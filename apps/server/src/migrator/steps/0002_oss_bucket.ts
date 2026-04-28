import { ossClient } from '../../utils/oss';
import { serverConfig } from '../../env';
import type { MigrationStep } from '../types';

// Read-only preflight: confirm the configured OSS bucket exists. Bucket lifecycle
// (creation, CORS, lifecycle policies) is owned manually outside this codebase —
// the migrator never writes bucket-level config. If the bucket is missing, fail
// fast with a clear message so the operator can fix it before the server starts
// serving uploads.
export const ossBucketStep: MigrationStep = {
  id: '0002_oss_bucket_preflight',
  description: 'Verify OSS bucket exists',
  apply: async () => {
    try {
      await ossClient.getBucketInfo(serverConfig.ALIYUN_OSS_BUCKET);
      return 'skipped';
    } catch (e: any) {
      if (e?.code === 'NoSuchBucket') {
        throw new Error(
          `OSS bucket '${serverConfig.ALIYUN_OSS_BUCKET}' not found in region '${serverConfig.ALIYUN_OSS_REGION}'. ` +
          `Create it manually (and configure CORS) before starting the server.`,
        );
      }
      throw e;
    }
  },
};
