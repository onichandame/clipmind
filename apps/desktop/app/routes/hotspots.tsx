import { useState } from 'react';
import { useLoaderData, useNavigate } from 'react-router';
import { Flame, TrendingUp, Loader2 } from 'lucide-react';
import { env } from '../env';

interface Hotspot {
  id: string;
  category: string;
  title: string;
  description: string;
  source: 'xiaohongshu' | 'wechat' | 'douyin' | 'bilibili' | 'mixed';
  heatMetric: string;
  fetchedAt: string;
}

interface Category {
  name: string;
  count: number;
}

interface LoaderData {
  hotspots: Hotspot[];
  categories: Category[];
}

const SOURCE_META: Record<string, { label: string; dot: string }> = {
  xiaohongshu: { label: '小红书', dot: 'bg-red-500' },
  wechat:      { label: '微信',   dot: 'bg-green-500' },
  douyin:      { label: '抖音',   dot: 'bg-zinc-800 dark:bg-zinc-200' },
  bilibili:    { label: 'B站',    dot: 'bg-pink-500' },
  mixed:       { label: '多平台', dot: 'bg-indigo-500' },
};

export async function clientLoader(): Promise<LoaderData> {
  try {
    const res = await fetch(`${env.VITE_API_BASE_URL}/api/hotspots`);
    if (!res.ok) return { hotspots: [], categories: [] };
    return res.json() as Promise<LoaderData>;
  } catch {
    return { hotspots: [], categories: [] };
  }
}

export default function HotspotsLibrary() {
  const { hotspots, categories } = useLoaderData<typeof clientLoader>();
  const navigate = useNavigate();
  const [activeCategory, setActiveCategory] = useState<string>('全部');
  const [creatingId, setCreatingId] = useState<string | null>(null);

  const filtered = activeCategory === '全部'
    ? hotspots
    : hotspots.filter(h => h.category === activeCategory);

  const handleCreate = async (hotspot: Hotspot) => {
    if (creatingId) return;
    setCreatingId(hotspot.id);
    try {
      const res = await fetch(`${env.VITE_API_BASE_URL}/api/projects/from-hotspot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hotspotId: hotspot.id }),
      });
      if (!res.ok) throw new Error('创建失败');
      const { id } = await res.json();
      navigate(`/projects/${id}`);
    } catch (e) {
      console.error('[Hotspots] 创建项目失败:', e);
      setCreatingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 p-8 font-sans transition-colors duration-200">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <Flame className="w-6 h-6 text-orange-500" />
          <h1 className="text-2xl font-semibold tracking-tight">今日热点</h1>
          <span className="ml-2 text-sm text-zinc-500 dark:text-zinc-400">每日更新 · 小红书/微信为主</span>
        </div>

        {/* Category Tabs */}
        {categories.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-6">
            {['全部', ...categories.map(c => c.name)].map(cat => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-150 ${
                  activeCategory === cat
                    ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900'
                    : 'bg-zinc-100 dark:bg-zinc-800/60 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700/60'
                }`}
              >
                {cat}
                {cat !== '全部' && (
                  <span className="ml-1.5 text-xs opacity-60">
                    {categories.find(c => c.name === cat)?.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Empty State */}
        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center h-64 border-2 border-dashed border-zinc-300 dark:border-zinc-800 rounded-xl text-zinc-500 bg-zinc-50/50 dark:bg-transparent transition-colors">
            <TrendingUp className="w-12 h-12 mb-4 opacity-40" />
            {hotspots.length === 0 ? (
              <>
                <p className="text-zinc-600 dark:text-zinc-400 font-medium mb-1">正在拉取今日热点，稍等片刻…</p>
                <p className="text-zinc-400 dark:text-zinc-600 text-sm">服务启动后首次拉取通常需要 2-5 分钟</p>
              </>
            ) : (
              <p className="text-zinc-500 dark:text-zinc-500">该分类暂无热点</p>
            )}
          </div>
        )}

        {/* Hotspot Grid */}
        {filtered.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map(hotspot => {
              const meta = SOURCE_META[hotspot.source] ?? SOURCE_META.mixed;
              const isCreating = creatingId === hotspot.id;
              return (
                <div
                  key={hotspot.id}
                  className="group bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 flex flex-col gap-3 hover:border-zinc-300 dark:hover:border-zinc-700 hover:shadow-sm transition-all duration-200"
                >
                  {/* Tags row */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                      {hotspot.category}
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-500">
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${meta.dot}`} />
                      {meta.label}
                    </span>
                  </div>

                  {/* Title */}
                  <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 leading-snug line-clamp-2">
                    {hotspot.title}
                  </h3>

                  {/* Description */}
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed line-clamp-3 flex-1">
                    {hotspot.description}
                  </p>

                  {/* Heat metric */}
                  <div className="flex items-center gap-1.5 text-xs text-orange-500 dark:text-orange-400 font-medium">
                    <Flame className="w-3.5 h-3.5" />
                    <span>{hotspot.heatMetric}</span>
                  </div>

                  {/* CTA */}
                  <button
                    onClick={() => handleCreate(hotspot)}
                    disabled={!!creatingId}
                    className="mt-1 w-full py-2 rounded-lg text-xs font-semibold bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-300 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-150 flex items-center justify-center gap-1.5"
                  >
                    {isCreating ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        创建中…
                      </>
                    ) : '用这个热点创作'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
