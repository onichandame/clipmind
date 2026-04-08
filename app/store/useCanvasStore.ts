import { create } from 'zustand';

type CanvasMode = 'outline' | 'footage' | 'split';

interface CanvasState {
  activeMode: CanvasMode;
  setActiveMode: (mode: CanvasMode) => void;
}

export const useCanvasStore = create<CanvasState>((set) => ({
  activeMode: 'outline',
  setActiveMode: (mode) => set({ activeMode: mode }),
}));