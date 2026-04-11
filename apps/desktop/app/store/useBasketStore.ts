import { create } from 'zustand';

interface BasketItem {
  id: string;
  projectId: string;
  assetChunkId: string;
  sortRank: string;
  addedAt: Date;
}

interface BasketState {
  items: BasketItem[];
  addItem: (item: BasketItem) => void;
  removeItem: (id: string) => void;
  clearBasket: () => void;
  setItems: (items: BasketItem[]) => void;
}

export const useBasketStore = create<BasketState>((set) => ({
  items: [],
  addItem: (item) => set((state) => ({ items: [...state.items, item] })),
  removeItem: (id) => set((state) => ({ items: state.items.filter((item) => item.id !== id) })),
  clearBasket: () => set({ items: [] }),
  setItems: (items) => set({ items }),
}));