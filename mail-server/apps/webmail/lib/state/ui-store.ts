import { create } from 'zustand';

type UIStore = {
  sidebarPinned: boolean;
  toggleSidebarPinned: () => void;
};

export const useUIStore = create<UIStore>((set) => ({
  sidebarPinned: true,
  toggleSidebarPinned: () => set((state) => ({ sidebarPinned: !state.sidebarPinned })),
}));
