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
      storage: layoutStorage,
      // Bump version after dropping the dual-rail era's `navRailExpanded` /
      // `assistantPanelOpen` fields. The new sidebar architecture is too
      // different from the old one to migrate field-by-field — flatten any
      // legacy persisted blob (or a missing one) to the new default.
      version: 2,
      migrate: () => ({ sidebarExpanded: true }),
      partialize: (state) => ({ sidebarExpanded: state.sidebarExpanded }),
    },
  ),
);
