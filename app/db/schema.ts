// app/db/schema.ts
import { mysqlTable, varchar, text, int, timestamp } from 'drizzle-orm/mysql-core';

// ==========================================
// 模块 A：全局资产库 (The Asset Data Layer)
// ==========================================

// NEW: 视频源文件记录
export const assets = mysqlTable('assets', {
  id: varchar('id', { length: 36 }).primaryKey(),
  filename: varchar('filename', { length: 255 }).notNull(),
  ossUrl: varchar('oss_url', { length: 1024 }).notNull(),
  fileSize: int('file_size').notNull(), // 上传时直传获取(Byte)
  status: varchar('status', { length: 20 }).default('processing'), // processing | ready | error
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
});

export const projectOutlines = mysqlTable('project_outlines', {
  id: varchar('id', { length: 36 }).primaryKey(),
  projectId: varchar('project_id', { length: 36 }).notNull().unique(),
  contentMd: text('content_md').notNull(),
  version: int('version').notNull().default(1), // 乐观锁版本号
});

export const basketItems = mysqlTable('basket_items', {
  id: varchar('id', { length: 36 }).primaryKey(),
  projectId: varchar('project_id', { length: 36 }).notNull(),
  assetChunkId: varchar('asset_chunk_id', { length: 36 }).notNull(),
  sortRank: varchar('sort_rank', { length: 255 }).notNull(), // LexoRank 排序算法，防拖拽抖动
  addedAt: timestamp('added_at').defaultNow().notNull(),
});
