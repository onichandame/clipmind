import { mysqlTable, varchar, text, int, timestamp } from 'drizzle-orm/mysql-core';

export const projects = mysqlTable('projects', {
  id: varchar('id', { length: 36 }).primaryKey(),
  title: varchar('title', { length: 255 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const projectOutlines = mysqlTable('project_outlines', {
  id: varchar('id', { length: 36 }).primaryKey(),
  projectId: varchar('project_id', { length: 36 }).notNull().unique(),
  contentMd: text('content_md').notNull(),
  version: int('version').notNull().default(1),
});

export const basketItems = mysqlTable('basket_items', {
  id: varchar('id', { length: 36 }).primaryKey(),
  projectId: varchar('project_id', { length: 36 }).notNull(),
  assetChunkId: varchar('asset_chunk_id', { length: 36 }).notNull(),
  sortRank: varchar('sort_rank', { length: 255 }).notNull(),
  addedAt: timestamp('added_at').defaultNow().notNull(),
});