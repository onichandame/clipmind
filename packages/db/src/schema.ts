// app/db/schema.ts
import { mysqlTable, varchar, text, int, timestamp, json, boolean, index } from 'drizzle-orm/mysql-core';

// ==========================================
// 模块 0：用户与会话 (Identity Layer)
// ==========================================

export const users = mysqlTable('users', {
  id: varchar('id', { length: 36 }).primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  emailVerifiedAt: timestamp('email_verified_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  memoryMd: text('memory_md'),
  memoryUpdatedAt: timestamp('memory_updated_at'),
});

// 单次性 webhook nonce 防重放：oss-callback 在校验 HMAC 后插入 nonce；
// 主键唯一约束保证同一 nonce 第二次写入会触发 dup key error，从而被拒绝。
export const webhookNonces = mysqlTable('webhook_nonces', {
  nonce: varchar('nonce', { length: 64 }).primaryKey(),
  consumedAt: timestamp('consumed_at').defaultNow().notNull(),
});

export const sessions = mysqlTable('sessions', {
  id: varchar('id', { length: 36 }).primaryKey(),
  userId: varchar('user_id', { length: 36 })
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(), // sha256 hex
  userAgent: varchar('user_agent', { length: 255 }),
  lastSeenAt: timestamp('last_seen_at').defaultNow().notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  revokedAt: timestamp('revoked_at'),
}, (t) => ({
  userIdx: index('idx_sessions_user').on(t.userId),
}));

// ==========================================
// 模块 A：资产处理层 (The Asset Data Layer)
//
// 两层分离设计：
//   media_files  — 以文件哈希去重的底层处理单元（ASR/摘要/向量归属于此）
//   project_assets — 每个项目独立的资产引用（UI/用户看到的 assetId 来自此表）
// ==========================================

// 底层：去重处理单元。同一用户上传相同文件到不同项目时，此表只有一行。
export const mediaFiles = mysqlTable('media_files', {
  id: varchar('id', { length: 36 }).primaryKey(),
  userId: varchar('user_id', { length: 36 })
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  fileHash: varchar('file_hash', { length: 64 }).notNull(), // SHA-256 hex of original video
  audioOssKey: varchar('audio_oss_key', { length: 1024 }), // 音频强制上云用于 ASR
  thumbnailOssKey: varchar('thumbnail_oss_key', { length: 1024 }), // 缩略图强制上云用于跨设备
  fileSize: int('file_size').notNull(),
  duration: int('duration'),
  status: varchar('status', { length: 20 }).default('processing'), // processing | ready | error
  asrTaskId: varchar('asr_task_id', { length: 128 }),
  asrStatus: varchar('asr_status', { length: 20 }).default('pending'), // pending | processing | completed | failed | skipped
  summary: text('summary'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  userIdx: index('idx_media_files_user').on(t.userId),
  // 同一用户同一文件只处理一次
  userHashUnique: index('idx_media_files_user_hash').on(t.userId, t.fileHash),
}));

// 项目层：每个项目有独立的资产列表，多个项目可指向同一 media_file。
export const projectAssets = mysqlTable('project_assets', {
  id: varchar('id', { length: 36 }).primaryKey(),
  projectId: varchar('project_id', { length: 36 })
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  userId: varchar('user_id', { length: 36 })
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  mediaFileId: varchar('media_file_id', { length: 36 })
    .notNull()
    .references(() => mediaFiles.id, { onDelete: 'cascade' }),
  filename: varchar('filename', { length: 255 }).notNull(),
  // 注意：localPath / originDeviceId 已迁移至桌面端 SQLite (apps/desktop/src-tauri/src/local_db.rs)。
  // 同一用户的同一份 media_file 可能在不同设备上保存于不同路径，BE 不再作为这类信息的权威源。
  videoOssKey: varchar('video_oss_key', { length: 1024 }), // 仅在用户开启云备份时填充
  // 云备份生命周期：local_only | queued | uploading | backed_up | stale | failed
  backupStatus: varchar('backup_status', { length: 20 }).default('local_only').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  projectIdx: index('idx_project_assets_project').on(t.projectId),
  userIdx: index('idx_project_assets_user').on(t.userId),
  mediaFileIdx: index('idx_project_assets_media_file').on(t.mediaFileId),
}));

// ASR 切片记录，归属底层 media_file（与项目无关）
export const assetChunks = mysqlTable('asset_chunks', {
  id: varchar('id', { length: 36 }).primaryKey(),
  mediaFileId: varchar('media_file_id', { length: 36 })
    .notNull()
    .references(() => mediaFiles.id, { onDelete: 'cascade' }),
  startTime: int('start_time').notNull(),
  endTime: int('end_time').notNull(),
  transcriptText: text('transcript_text').notNull(),
}, (t) => ({
  mediaFileIdx: index('idx_asset_chunks_media_file').on(t.mediaFileId),
}));

// ==========================================
// 模块 B：创作工作台 (The Workspace Layer)
// ==========================================

export const projects = mysqlTable('projects', {
  id: varchar('id', { length: 36 }).primaryKey(),
  userId: varchar('user_id', { length: 36 })
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 255 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
  workflowMode: varchar('workflow_mode', { length: 20 }), // material | idea | freechat | null
  pinnedAt: timestamp('pinned_at'),
  uiMessages: json('ui_messages').default([]),
  retrievedClips: json('retrieved_clips').default([]),
  retrievedAssetIds: json('retrieved_asset_ids').default([]),
  selectedAssetIds: json('selected_asset_ids').default([]),
  editingPlans: json('editing_plans').default([]),
}, (t) => ({
  userIdx: index('idx_projects_user').on(t.userId),
  userUpdatedIdx: index('idx_projects_user_updated').on(t.userId, t.updatedAt),
}));

export const projectOutlines = mysqlTable('project_outlines', {
  id: varchar('id', { length: 36 }).primaryKey(),
  projectId: varchar('project_id', { length: 36 })
    .notNull()
    .unique()
    .references(() => projects.id, { onDelete: 'cascade' }),
  contentMd: text('content_md').notNull(),
  version: int('version').notNull().default(1),
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
  // Higher = earlier in the list. New plans get MAX+1 so they appear at the top;
  // user reorder writes monotonically descending values.
  displayOrder: int('display_order').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ==========================================
// 模块 C：热点库 (Hotspot Library) — 公共内容，不挂用户
// ==========================================

export const hotspots = mysqlTable('hotspots', {
  id: varchar('id', { length: 36 }).primaryKey(),
  batchId: varchar('batch_id', { length: 36 }).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  category: varchar('category', { length: 40 }).notNull(),
  title: varchar('title', { length: 200 }).notNull(),
  description: text('description').notNull(),
  source: varchar('source', { length: 20 }).notNull(),
  sourceUrls: json('source_urls').$type<string[]>().notNull(),
  heatMetric: varchar('heat_metric', { length: 50 }).notNull(),
  heatScore: int('heat_score').notNull(),
  rationale: text('rationale'),
  rawContext: json('raw_context'),
  fetchedAt: timestamp('fetched_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  activeByCategory: index('idx_hotspots_active_category').on(t.isActive, t.category, t.heatScore),
  batchIdx: index('idx_hotspots_batch').on(t.batchId),
}));
