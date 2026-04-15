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
  asrStatus: varchar('asr_status', { length: 20 }).default('pending'), // pending | processing | completed | failed
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
  uiMessages: json('ui_messages').default([]), // UI 消息历史（简化结构）
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

export const basketItems = mysqlTable('basket_items', {
  id: varchar('id', { length: 36 }).primaryKey(),
  projectId: varchar('project_id', { length: 36 })
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }), // 级联删除
  assetChunkId: varchar('asset_chunk_id', { length: 36 })
    .notNull()
    .references(() => assetChunks.id, { onDelete: 'cascade' }), // 素材删了，篮子也清
  sortRank: varchar('sort_rank', { length: 255 }).notNull(),
  addedAt: timestamp('added_at').defaultNow().notNull(),
});

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
