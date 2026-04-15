import { create } from 'zustand';

type CanvasMode = 'outline' | 'footage' | 'plan' | 'split';

interface CanvasState {
  activeMode: CanvasMode;
  setActiveMode: (mode: CanvasMode) => void;

  // 人机协同核心状态
  outlineContent: string; // 存储大纲的 Markdown 文本
  editingPlan: any | null; // 存储剪辑方案数据
  isDirty: boolean;        // 脏标记：用户是否手动修改过
  lastModifiedBy: 'user' | 'agent' | 'system';

  // 动作
  setOutlineContent: (content: string, modifiedBy: 'user' | 'agent' | 'system') => void;
  setEditingPlan: (plan: any) => void;
  clearDirtyState: () => void;
}

export const useCanvasStore = create<CanvasState>((set) => ({
  activeMode: 'outline',
  setActiveMode: (mode) => set({ activeMode: mode }),

  outlineContent: '',
  editingPlan: null,
  isDirty: false,
  lastModifiedBy: 'system',

  setOutlineContent: (content, modifiedBy) => set((state) => ({
    outlineContent: content,
    lastModifiedBy: modifiedBy,
    // 只有当用户修改时，才将其标记为 dirty，引发对 Agent 的强制重新读取警告
    isDirty: modifiedBy === 'user' ? true : state.isDirty
  })),

  setEditingPlan: (plan) => set({ editingPlan: plan }),

  clearDirtyState: () => set({ isDirty: false }),
}));
