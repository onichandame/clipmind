# ClipMind Stage 1 Testing Guide

## Prerequisites

- Dev server must be running
- `DATABASE_URL=mysql2://root:123@localhost:3306/clipmind` set

## Start Dev Server

```bash
npm run dev
```

**Note:** Port may be 5173 or 5174 (5173 may be in use, server falls back to 5174). Check terminal output for actual port.

---

## Test Read Route

### List All Projects

```bash
curl http://localhost:5174/test-read
```

### Read Single Project

```bash
curl http://localhost:5174/test-read/:id
```

### 404 for Nonexistent

```bash
curl http://localhost:5174/test-read/nonexistent-id
```

---

## Test Write Route

### Create Project (with title)

```bash
curl -X POST http://localhost:5174/test-write \
  -H "Content-Type: application/json" \
  -d '{"title": "My Test Project"}'
```

### 400 for Missing Title

```bash
curl -X POST http://localhost:5174/test-write \
  -H "Content-Type: application/json" \
  -d '{}'
```

### Check Write Route Status

```bash
curl http://localhost:5174/test-write
```

---

## Round-Trip Verification

1. Create a project and extract the ID:

```bash
curl -X POST http://localhost:5174/test-write \
  -H "Content-Type: application/json" \
  -d '{"title": "Round-Trip Test"}'
```

2. Read back using the returned ID:

```bash
curl http://localhost:5174/test-read/:id
```

3. Verify the title matches what was created.

---

## Project Outlines Table Verification

The `project_outlines` table schema:
- `id` (varchar36, PK)
- `project_id` (varchar36, NOT NULL, UNIQUE)
- `content_md` (text, NOT NULL)
- `version` (int, NOT NULL, default 1)

### Manual SQL Insert

Use a Node script or MySQL client:

```sql
INSERT INTO project_outlines (id, project_id, content_md, version)
VALUES (UUID(), 'YOUR_PROJECT_ID', '# Outline Content\n\n- Item 1\n- Item 2', 1);
```

### Verify Outline Exists

```bash
curl http://localhost:5174/test-read/:project_id
```

Or check via Node script to query the database directly.
