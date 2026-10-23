import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemeMode = 'system' | 'light' | 'dark';
export type RightPanelTab = 'preview' | 'diff' | 'terminal' | 'files';

export const RIGHT_PANEL_MIN = 280;
export const RIGHT_PANEL_MAX = 720;
export const RIGHT_PANEL_DEFAULT = 420;

export const clampPanelWidth = (width: number): number =>
  Math.min(
    RIGHT_PANEL_MAX,
    Math.max(RIGHT_PANEL_MIN, Math.round(Number.isFinite(width) ? width : RIGHT_PANEL_DEFAULT)),
  );

interface UiState {
  sidebarOpen: boolean;
  rightPanelOpen: boolean;
  rightPanelWidth: number;
  rightPanelTab: RightPanelTab;
  theme: ThemeMode;
  paletteOpen: boolean;
  /** Naik tiap Ctrl+N; layar chat memakainya untuk memulai percakapan baru. */
  newChatSignal: number;
  /** Project yang sedang dikerjakan (chat per folder); null = chat umum. */
  activeProjectId: string | null;
  /** Branch kerja agent dari run coding yang sedang berjalan, untuk status bar; tidak disimpan. */
  activeRunBranch: string | null;
  setActiveProject: (id: string | null) => void;
  setActiveRunBranch: (branch: string | null) => void;
  toggleSidebar: () => void;
  toggleRightPanel: () => void;
  setRightPanelWidth: (width: number) => void;
  setRightPanelTab: (tab: RightPanelTab) => void;
  setTheme: (theme: ThemeMode) => void;
  setPaletteOpen: (open: boolean) => void;
  requestNewChat: () => void;
}

/** Keadaan tampilan yang diingat antar sesi (lebar panel, sidebar, tab, tema) di localStorage. */
export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarOpen: true,
      rightPanelOpen: false,
      rightPanelWidth: RIGHT_PANEL_DEFAULT,
      rightPanelTab: 'preview',
      theme: 'system',
      paletteOpen: false,
      newChatSignal: 0,
      activeProjectId: null,
      activeRunBranch: null,
      setActiveProject: (activeProjectId) => set({ activeProjectId, activeRunBranch: null }),
      setActiveRunBranch: (activeRunBranch) => set({ activeRunBranch }),
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
      setRightPanelWidth: (width) => set({ rightPanelWidth: clampPanelWidth(width) }),
      setRightPanelTab: (rightPanelTab) => set({ rightPanelTab }),
      setTheme: (theme) => set({ theme }),
      setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
      requestNewChat: () => set((s) => ({ newChatSignal: s.newChatSignal + 1 })),
    }),
    {
      name: 'aios.ui',
      version: 1,
      partialize: (s) => ({
        sidebarOpen: s.sidebarOpen,
        rightPanelOpen: s.rightPanelOpen,
        rightPanelWidth: s.rightPanelWidth,
        rightPanelTab: s.rightPanelTab,
        activeProjectId: s.activeProjectId,
        theme: s.theme,
      }),
      // Nilai tersimpan yang rusak atau di luar batas dikembalikan ke aman.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<UiState>;
        return {
          ...current,
          ...p,
          rightPanelWidth: clampPanelWidth(p.rightPanelWidth ?? RIGHT_PANEL_DEFAULT),
        };
      },
    },
  ),
);

/** Menerapkan tema ke <html data-theme>; 'system' melepas atribut agar tokens.css mengikuti prefers-color-scheme. */
export function applyTheme(theme: ThemeMode, root: HTMLElement = document.documentElement): void {
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}
