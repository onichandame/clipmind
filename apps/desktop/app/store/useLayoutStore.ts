import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface LayoutState {
  sidebarExpanded: boolean;
  setSidebarExpanded: (v: boolean) => void;
}

// SSR-safe storage: React Router runs a static prerender pass where `window`
// doesn't exist; touching localStorage there would crash hydration. The getter
// fires lazily per access, so the guard is effective.
const layoutStorage = createJSONStorage<LayoutState>(() => {
  if (typeof window === 'undefined') {
    return { getItem: () => null, setItem: () => {}, removeItem: () => {} } as unknown as Storage;
  }
  return window.localStorage;
});

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      sidebarExpanded: true,
      setSidebarExpanded: (v) => set({ sidebarExpanded: v }),
    }),
    {
      name: 'clipmind:layout',
      storage: layoutStorage as any,
      partialize: (state) => ({ sidebarExpanded: state.sidebarExpanded }),
    },
  ),
);
