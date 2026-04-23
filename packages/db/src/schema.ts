// app/db/schema.ts
import { mysqlTable, varchar, text, int, timestamp, json } from 'drizzle-orm/mysql-core';

// ==========================================
// 模块 A：全局资产库 (The Asset Data Layer)
// ==========================================

// NEW: 视频源文件记录
export const assets = mysqlTable('assets', {
  id: varchar('id', { length: 36 }).primaryKey(),
  filename: varchar('filename', { length: 255 }).notNull(),
  ossUrl: varchar('oss_url', { length: 1024 }).notNull(), // 视频主轨道 URL
  audioOssUrl: varchar('audio_oss_url', { length: 1024 }), // NEW: 降维音频轨道 URL
  thumbnailUrl: varchar('thumbnail_url', { length: 1024 }), // NEW: 视频缩略图 URL
  fileSize: int('file_size').notNull(), // 上传时直传获取(Byte)
  duration: int('duration'), // NEW: 视频总时长(秒)
  status: varchar('status', { length: 20 }).default('processing'), // processing | ready | error
  asrTaskId: varchar('asr_task_id', { length: 128 }), // 阿里云 FileTrans 任务 ID
  asrStatus: varchar('asr_status', { length: 20 }).default('pending'), // pending | processing | completed | failed | skipped
  summary: text('summary'), // NEW: AI 总结 (视频级宏观描述)
  checksum: varchar('checksum', { length: 64 }), // NEW: 素材文件的 Hash 校验值 (预留秒传)
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// NEW: 视频切片记录 (ASR 结果)
export const assetChunks = mysqlTable('asset_chunks', {
  id: varchar('id', { length: 36 }).primaryKey(),
  assetId: varchar('asset_id', { length: 36 }).notNull(),
  startTime: int('start_time').notNull(), // ASR 返回毫秒级时间戳
  endTime: int('end_time').notNull(),
  transcriptText: text('transcript_text').notNull(), // 切片内的实际台词
});

// ==========================================
// 模块 B：创作工作台 (The Workspace Layer)
// ==========================================

export const projects = mysqlTable('projects', {
  id: varchar('id', { length: 36 }).primaryKey(),
  title: varchar('title', { length: 255 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
      updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(), // 用于 Dashboard 排序
  workflowMode: varchar('workflow_mode', { length: 20 }), // material | idea | null
  uiMessages: json('ui_messages').default([]), // UI 消息历史（简化结构）
  retrievedClips: json('retrieved_clips').default([]), // [Arch] 独立持久化的素材检索结果，脱离聊天历史
  retrievedAssetIds: json('retrieved_asset_ids').default([]), // [Arch] 宏观检索聚光灯结果
  selectedAssetIds: json('selected_asset_ids').default([]), // [Arch] 精挑素材（Asset 级）
  editingPlans: json('editing_plans').default([]), // [Arch] 多套剪辑方案列表与素材映射
});

export const projectOutlines = mysqlTable('project_outlines', {
  id: varchar('id', { length: 36 }).primaryKey(),
  projectId: varchar('project_id', { length: 36 })
    .notNull()
    .unique()
    .references(() => projects.id, { onDelete: 'cascade' }), // 级联删除
  contentMd: text('content_md').notNull(),
  version: int('version').notNull().default(1),
});

// [Arch] basketItems 表已被全链路废弃，精挑数据收敛于 projects.selectedAssetIds

export const editingPlans = mysqlTable('editing_plans', {
  id: varchar('id', { length: 36 }).primaryKey(),
  projectId: varchar('project_id', { length: 36 })
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 255 }).notNull(),
  platform: varchar('platform', { length: 100 }),
  targetDuration: int('target_duration'),
  clips: json('clips'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
