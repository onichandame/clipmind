import { useEffect, useState } from 'react';

const AUTO_DISMISS_MS = 5000;

// Pure non-interactive notification. No expand, no buttons, no diff viewer.
// Owner displays a fresh toast by bumping `nonce` whenever a new
// `tool-update_user_memory` part with state=output-available is observed.
export function MemoryUpdateToast({ nonce }: { nonce: number }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (nonce === 0) return;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [nonce]);

  if (!visible) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 pointer-events-none select-none">
      <div className="px-4 py-2.5 rounded-xl bg-zinc-900/90 dark:bg-zinc-100/90 text-zinc-100 dark:text-zinc-900 text-sm font-medium shadow-lg backdrop-blur-sm">
        ✏️ 已更新长期记忆
      </div>
    </div>
  );
}
