import { Hono } from 'hono';
import { db } from '../db';
import { hotspots } from '@clipmind/db/schema';
import { desc, eq, and, count } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth';

const app = new Hono();

app.use('*', requireAuth);

app.get('/', async (c) => {
  const category = c.req.query('category');
  const source = c.req.query('source');
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 100);

  const conditions = [eq(hotspots.isActive, true)];
  if (category) conditions.push(eq(hotspots.category, category));
  if (source) conditions.push(eq(hotspots.source, source as any));

  const [items, catRows] = await Promise.all([
    db.select({
      id: hotspots.id,
      category: hotspots.category,
      title: hotspots.title,
      description: hotspots.description,
      source: hotspots.source,
      heatMetric: hotspots.heatMetric,
      fetchedAt: hotspots.fetchedAt,
    })
      .from(hotspots)
      .where(and(...conditions))
      .orderBy(desc(hotspots.heatScore))
      .limit(limit),

    db.select({ name: hotspots.category, count: count() })
      .from(hotspots)
      .where(eq(hotspots.isActive, true))
      .groupBy(hotspots.category)
      .orderBy(desc(count())),
  ]);

  return c.json({ hotspots: items, categories: catRows });
});

export default app;
