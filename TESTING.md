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

---

# Stage 2 Testing Guide

## Prerequisites

- Dev server must be running (`npm run dev`)
- `DATABASE_URL=mysql2://root:123@localhost:3306/clipmind` set
- Stage 1 tables (`projects`, `project_outlines`) exist in MySQL
- Stage 2 table (`basket_items`) exists in MySQL

---

## Home Route Redirect

### Visit `/` — Auto-creates project and redirects

```bash
# Should return 302 redirect to /projects/<uuid>
curl -s -o /dev/null -w "%{http_code}" http://localhost:5174/
# Expected: 302

# Check redirect location
curl -s -I http://localhost:5174/ | grep location
# Expected: location: /projects/<some-uuid>
```

### Verify project was created in database

```bash
# List all projects and find "Untitled Project"
curl -s http://localhost:5174/test-read | python3 -c "
import json, sys
data = json.load(sys.stdin)
matches = [p for p in data['projects'] if 'Untitled' in p['title']]
print(json.dumps(matches[-1], indent=2))
"
```

---

## Project Workspace Route

### Direct navigation to existing project

```bash
# Use an existing project ID from test-read
PROJECT_ID=$(curl -s http://localhost:5174/test-read | python3 -c "
import json, sys
data = json.load(sys.stdin)
print(data['projects'][0]['id'])
")
echo "Project ID: $PROJECT_ID"

# Navigate to project workspace
curl -s http://localhost:5174/projects/$PROJECT_ID | grep -o 'ClipMind Chat'
# Expected: "ClipMind Chat" found in HTML
```

### Auto-creation for new project ID

```bash
# Navigate to a non-existent project ID
NEW_ID="test-auto-create-$(date +%s)"
curl -s http://localhost:5174/projects/$NEW_ID | grep -o 'ClipMind Chat'
# Expected: "ClipMind Chat" found in HTML (project auto-created)

# Verify it was created in DB
curl -s http://localhost:5174/test-read/$NEW_ID | python3 -m json.tool
# Expected: JSON with project data including title "Untitled Project"
```

---

## UI Component Verification

### Workspace layout renders

Open browser to `http://localhost:5174/` (will redirect to project page).

Verify:
- Left panel shows "ClipMind Chat" header
- Left panel shows "AI assistant will be available here in Stage 3" placeholder
- Left panel shows disabled "Type a message..." input
- Right panel shows three tabs: "Outline", "Footage", "Split View"
- Right panel shows placeholder text based on active tab
- Basket sidebar toggle button visible on right edge

### Canvas mode switching

In browser console:
```javascript
// Check current mode
window.__REACT_DEVTOOLS_GLOBAL_HOOK__ // React DevTools not required

// Switch modes via Zustand (in browser console)
// Note: Zustand stores are module-scoped, so direct access requires:
// Import useCanvasStore in a component or use React DevTools
```

### Basket sidebar

1. Click the basket toggle button (right edge of screen)
2. Verify sidebar slides in from the right
3. Verify "素材篮子 (Basket)" header is visible
4. Verify "No items in basket yet" empty state message
5. Click the close button (X) — sidebar should slide out

---

## Stage 1 Routes Still Functional

### Test Read

```bash
curl -s http://localhost:5174/test-read | python3 -m json.tool | head -5
# Expected: JSON array of projects
```

### Test Write

```bash
curl -s -X POST http://localhost:5174/test-write \
  -H "Content-Type: application/json" \
  -d '{"title": "Stage2 Verification"}'
# Expected: JSON with created project
```

---

## TypeScript & Build Verification

```bash
# Type check
npm run typecheck
# Expected: exit code 0, no errors

# Production build
npm run build
# Expected: successful build with no errors
```

---

## Basket Items Table Verification

The `basket_items` table schema:
- `id` (varchar36, PK)
- `project_id` (varchar36, NOT NULL)
- `asset_chunk_id` (varchar36, NOT NULL)
- `sort_rank` (varchar255, NOT NULL)
- `added_at` (timestamp, NOT NULL, default now())

### Verify table exists

```bash
npx drizzle-kit push
# Expected: "No changes detected" (table already exists)
```
