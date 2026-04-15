import { create } from 'zustand';

type CanvasMode = 'outline' | 'footage' | 'plan' | 'split';

interface ProjectState {
  outlineContent: string;
  editingPlan: any | null;
  isDirty: boolean;
  lastModifiedBy: 'user' | 'agent' | 'system';
  retrievedClips: any[];
}

const initialProjectState: ProjectState = {
  outlineContent: '',
  editingPlan: null,
  isDirty: false,
  lastModifiedBy: 'system',
  retrievedClips: [],
};

interface CanvasState {
  activeMode: CanvasMode;
  setActiveMode: (mode: CanvasMode) => void;
  projects: Record<string, ProjectState>;

  // 动作
  setOutlineContent: (projectId: string, content: string, modifiedBy: 'user' | 'agent' | 'system') => void;
  setEditingPlan: (projectId: string, plan: any) => void;
  clearDirtyState: (projectId: string) => void;
  setRetrievedClips: (projectId: string, clips: any[]) => void;
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

  setEditingPlan: (projectId, plan) => set((state) => {
    const pState = state.projects[projectId] || { ...initialProjectState };
    return {
      projects: { ...state.projects, [projectId]: { ...pState, editingPlan: plan } }
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
  })
}));
