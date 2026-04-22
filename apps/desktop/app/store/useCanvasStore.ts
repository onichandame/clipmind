import { create } from 'zustand';

type CanvasMode = 'outline' | 'footage' | 'plan';

export type JobStatus = 'queued' | 'compressing' | 'uploading' | 'ready' | 'error';
export interface UploadJob { id: string; filename: string; sourcePath: string; status: JobStatus; progress: number; }

interface ProjectState {
  outlineContent: string;
  editingPlans: any[];
  isDirty: boolean;
  lastModifiedBy: 'user' | 'agent' | 'system';
      retrievedClips: any[];
    }

const initialProjectState: ProjectState = {
  outlineContent: '',
  editingPlans: [],
  isDirty: false,
  lastModifiedBy: 'system',
      retrievedClips: [],
    };

interface CanvasState {
  activeMode: CanvasMode;
  setActiveMode: (mode: CanvasMode) => void;
  activePanelId: string | null;
  setActivePanelId: (id: string | null) => void;
  projects: Record<string, ProjectState>;
  
  // 全局上传状态机
  uploadJobs: UploadJob[];
  setUploadJobs: (jobs: UploadJob[] | ((prev: UploadJob[]) => UploadJob[])) => void;
  updateUploadJob: (id: string, updates: Partial<UploadJob>) => void;
  clearCompletedUploadJobs: () => void;

  // 动作
  setOutlineContent: (projectId: string, content: string, modifiedBy: 'user' | 'agent' | 'system') => void;
  setEditingPlans: (projectId: string, plans: any[]) => void;
  clearDirtyState: (projectId: string) => void;
  setSelectedBasket: (projectId: any, basket: any[]) => void
}

export const useCanvasStore = create<CanvasState>((set) => ({
  activeMode: 'outline',
  setActiveMode: (mode) => set({ activeMode: mode }),
  activePanelId: null,
  setActivePanelId: (id) => set({ activePanelId: id }),
  projects: {},

  uploadJobs: [],
  setUploadJobs: (jobs) => set((state) => ({ uploadJobs: typeof jobs === 'function' ? jobs(state.uploadJobs) : jobs })),
  updateUploadJob: (id, updates) => set((state) => ({
    uploadJobs: state.uploadJobs.map(j => j.id === id ? { ...j, ...updates } : j)
  })),
  clearCompletedUploadJobs: () => set((state) => {
    if (state.uploadJobs.every(j => j.status === 'ready' || j.status === 'error')) return { uploadJobs: [] };
    return state;
  }),

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
      })
    }));
