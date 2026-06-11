import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildProjectTitlePrompt, sanitizeProjectTitle, workflowModeLabel } from './title';

test('sanitizes generated project titles for UI display', () => {
  assert.equal(sanitizeProjectTitle(' “留学申请规划。” '), '留学申请规划');
  assert.equal(sanitizeProjectTitle('\nAI 视频脚本\t优化\n'), 'AI 视频脚本 优化');
  assert.equal(sanitizeProjectTitle(''), null);
});

test('truncates generated project titles to a short sidebar-safe length', () => {
  const title = sanitizeProjectTitle('这是一个非常非常非常非常非常非常长的项目标题需要被截断');
  assert.equal(Array.from(title ?? '').length, 24);
  assert.equal(title?.startsWith('这是一个非常非常'), true);
});

test('maps workflow modes into title generation context', () => {
  assert.equal(workflowModeLabel('material'), '素材驱动的视频剪辑项目');
  assert.equal(workflowModeLabel('idea'), '灵感探索与选题策划项目');
  assert.equal(workflowModeLabel('freechat'), '自由对话项目');
  assert.equal(workflowModeLabel(null), '视频创作项目');
});

test('builds project title prompt from the first user message only', () => {
  const prompt = buildProjectTitlePrompt('我想做一个关于英国留学选校的视频', 'idea');
  assert.match(prompt, /灵感探索与选题策划项目/);
  assert.match(prompt, /我想做一个关于英国留学选校的视频/);
  assert.match(prompt, /不要使用“未命名”/);
});

test('project title initialization migration is registered and preserves existing titles', () => {
  const journal = JSON.parse(readFileSync(new URL('../../../../packages/db/src/migrations/meta/_journal.json', import.meta.url), 'utf8'));
  assert.equal(
    journal.entries.some((entry: any) => entry.tag === '0012_project_title_initialized'),
    true,
  );

  const migration = readFileSync(new URL('../../../../packages/db/src/migrations/0012_project_title_initialized.sql', import.meta.url), 'utf8');
  assert.match(migration, /ADD `title_initialized` boolean DEFAULT false NOT NULL/);
  assert.match(migration, /UPDATE `projects` SET `title_initialized` = true/);
});
