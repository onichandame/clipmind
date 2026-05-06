import { useEffect } from 'react';
import { create } from 'zustand';

interface ToastItem {
  id: string;
  message: string;
  duration: number;
}

interface ToastStore {
  toasts: ToastItem[];
  push: (message: string, duration?: number) => void;
  remove: (id: string) => void;
}

const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  push: (message, duration = 3000) => {
    const id = crypto.randomUUID();
    set((s) => ({ toasts: [...s.toasts, { id, message, duration }] }));
  },
  remove: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

// Imperative API — call from anywhere (mutation onSuccess, click handlers, …)
// without needing to be inside a component tree.
export const toast = (message: string, duration?: number) => {
  useToastStore.getState().push(message, duration);
};

// Mount once at the app root. Renders the live queue stacked bottom-right;
// each item self-dismisses after its duration via ToastSlot's effect.
export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 items-end pointer-events-none select-none">
      {toasts.map((t) => (
        <ToastSlot key={t.id} item={t} />
      ))}
    </div>
  );
}

function ToastSlot({ item }: { item: ToastItem }) {
  const remove = useToastStore((s) => s.remove);
  useEffect(() => {
    const timer = setTimeout(() => remove(item.id), item.duration);
    return () => clearTimeout(timer);
  }, [item.id, item.duration, remove]);
  return (
    <div className="px-4 py-2.5 rounded-xl bg-zinc-900/90 dark:bg-zinc-100/90 text-zinc-100 dark:text-zinc-900 text-sm font-medium shadow-lg backdrop-blur-sm">
      {item.message}
    </div>
  );
}
