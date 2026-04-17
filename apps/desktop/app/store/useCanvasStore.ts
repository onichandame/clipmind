import { create } from 'zustand';

type CanvasMode = 'outline' | 'footage' | 'plan';

interface ProjectState {
  outlineContent: string;
  editingPlans: any[];
  isDirty: boolean;
  lastModifiedBy: 'user' | 'agent' | 'system';
  retrievedClips: any[];
  selectedBasket: any[];
}

const initialProjectState: ProjectState = {
  outlineContent: '',
  editingPlans: [],
  isDirty: false,
  lastModifiedBy: 'system',
  retrievedClips: [],
  selectedBasket: [],
};

interface CanvasState {
  activeMode: CanvasMode;
  setActiveMode: (mode: CanvasMode) => void;
  projects: Record<string, ProjectState>;

  // 动作
  setOutlineContent: (projectId: string, content: string, modifiedBy: 'user' | 'agent' | 'system') => void;
  setEditingPlans: (projectId: string, plans: any[]) => void;
  clearDirtyState: (projectId: string) => void;
  setSelectedBasket: (projectId: any, basket: any[]) => void
}

export const useCanvasStore = create<CanvasState>((set) => ({
  activeMode: 'outline',
  setActiveMode: (mode) => set({ activeMode: mode }),
  projects: {},

  setOutlineContent: (projectId, content, modifiedBy) => set((state) => {
    const pState = state.projects[projectId] || { ...initialProjectState };
    return {
      projects: {
        ...state.projects,
        [projectId]: {
          ...pState,
          outlineContent: content,
          lastModifiedBy: modifiedBy,
          isDirty: modifiedBy === 'user' ? true : pState.isDirty
        }
      }
    };
  }),

  setEditingPlans: (projectId, plans) => set((state) => {
    console.log(`📍 [PROBE 3 - STORE] Zustand 接收到更新! Project: ${projectId}, Plans数量: ${plans?.length}`);
    const pState = state.projects[projectId] || { ...initialProjectState };
    return {
      projects: { ...state.projects, [projectId]: { ...pState, editingPlans: plans } }
    };
  }),

  clearDirtyState: (projectId) => set((state) => {
    if (!state.projects[projectId]) return state;
    return {
      projects: {
        ...state.projects,
        [projectId]: { ...state.projects[projectId], isDirty: false }
      }
    };
  }),

  setRetrievedClips: (projectId, clips) => set((state) => {
    const pState = state.projects[projectId] || { ...initialProjectState };
    return {
      projects: { ...state.projects, [projectId]: { ...pState, retrievedClips: clips } }
    };
  }),

  setSelectedBasket: (projectId: any, basket: any[]) => set((state: any) => {
    const pState = state.projects[projectId] || { ...initialProjectState };
    return {
      projects: { ...state.projects, [projectId]: { ...pState, selectedBasket: basket } }
    };
  })
}));
