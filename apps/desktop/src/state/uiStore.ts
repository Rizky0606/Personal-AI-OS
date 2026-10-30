import { create } from 'zustand';
import type { ActivityStep } from '../activity/activity';
import { persist } from 'zustand/middleware';
import {
  ROOT_ID,
  closePane,
  parsePaneTree,
  revealTab,
  setLeafTab,
  setSplitRatio,
  splitPane,
  type PaneNode,
  type PaneTab,
  type SplitDirection,
} from '../panes/tree';

export type ThemeMode = 'system' | 'light' | 'dark';
export type RightPanelTab = PaneTab;

const newPaneId = () => Math.random().toString(36).slice(2, 10);

export const RIGHT_PANEL_MIN = 280;
export const RIGHT_PANEL_MAX = 960;
export const RIGHT_PANEL_DEFAULT = 420;

export const clampPanelWidth = (width: number): number =>
  Math.min(
    RIGHT_PANEL_MAX,
    Math.max(RIGHT_PANEL_MIN, Math.round(Number.isFinite(width) ? width : RIGHT_PANEL_DEFAULT)),
  );

/** Konteks dari preview (mis. elemen terpilih) yang ikut terkirim bersama pesan berikutnya. */
export interface ContextAttachment {
  id: string;
  /** Label singkat di composer, mis. selector elemen. */
  label: string;
  /** Teks yang ditambahkan ke pesan. */
  text: string;
  /** Data URL PNG untuk pratinjau kecil; tidak dikirim. */
  thumbnail?: string | undefined;
}

interface UiState {
  sidebarOpen: boolean;
  rightPanelOpen: boolean;
  rightPanelWidth: number;
  rightPanelTab: RightPanelTab;
  /** Pembagian panel kanan menjadi beberapa pane; null = satu pane yang menampilkan `rightPanelTab`. */
  paneTree: PaneNode | null;
  theme: ThemeMode;
  /** Kurangi gerakan: null = ikuti sistem. Diingat antar sesi. */
  reduceMotion: boolean | null;
  /** Notifikasi info sebagai toast di aplikasi; error selalu tampil. Diingat antar sesi. */
  inAppToasts: boolean;
  paletteOpen: boolean;
  /** Naik tiap Ctrl+N; layar chat memakainya untuk memulai percakapan baru. */
  newChatSignal: number;
  /** Project yang sedang dikerjakan (chat per folder); null = chat umum. */
  activeProjectId: string | null;
  /** Branch kerja agent dari run coding yang sedang berjalan, untuk status bar; tidak disimpan. */
  activeRunBranch: string | null;
  /** Run coding yang hasilnya sedang menunggu tinjauan (tab Diff); tidak disimpan. */
  reviewRunId: string | null;
  /** Langkah tool run terbaru di chat yang terbuka, untuk panel Aktivitas dan penanda di Berkas; tidak disimpan. */
  agentSteps: ActivityStep[];
  setAgentSteps: (steps: ActivityStep[]) => void;
  /** Permintaan membuka berkas di tab Berkas (dari Aktivitas); `nonce` membedakan permintaan yang sama; tidak disimpan. */
  fileRequest: { path: string; nonce: number } | null;
  requestFile: (path: string) => void;
  /** Cari di web untuk pesan berikutnya (chat umum dan project). Diingat antar sesi. */
  webSearch: boolean;
  setWebSearch: (on: boolean) => void;
  /** Paket skill tambahan untuk pesan berikutnya (selain pilihan otomatis dari kata kunci); tidak disimpan. */
  skillPacks: string[];
  setSkillPacks: (ids: string[]) => void;
  /** Model pilihan untuk pesan berikutnya; null = otomatis (router/combo). Diingat antar sesi. */
  model: string | null;
  setModel: (model: string | null) => void;
  /** Role yang sedang dipakai chat (pilihan manual atau keputusan router) untuk status bar; tidak disimpan. */
  activeRole: string | null;
  setActiveRole: (role: string | null) => void;
  /** Lampiran konteks untuk pesan berikutnya; tidak disimpan. */
  attachments: ContextAttachment[];
  addAttachment: (attachment: ContextAttachment) => void;
  removeAttachment: (id: string) => void;
  clearAttachments: () => void;
  /** Membuka panel kanan di tab Diff untuk run ini. */
  openReview: (runId: string) => void;
  setReviewRunId: (runId: string | null) => void;
  setActiveProject: (id: string | null) => void;
  setActiveRunBranch: (branch: string | null) => void;
  toggleSidebar: () => void;
  toggleRightPanel: () => void;
  /** Membuka panel kanan di tab tertentu. */
  openPanel: (tab: RightPanelTab) => void;
  setRightPanelWidth: (width: number) => void;
  setRightPanelTab: (tab: RightPanelTab) => void;
  /** Membagi pane; pane baru menampilkan tab yang belum terlihat. */
  splitPane: (leafId: string, direction: SplitDirection) => void;
  closePane: (leafId: string) => void;
  setPaneTab: (leafId: string, tab: RightPanelTab) => void;
  setPaneRatio: (splitId: string, ratio: number) => void;
  setTheme: (theme: ThemeMode) => void;
  setReduceMotion: (value: boolean | null) => void;
  setInAppToasts: (on: boolean) => void;
  setPaletteOpen: (open: boolean) => void;
  requestNewChat: () => void;
}

/** Keadaan tampilan yang diingat antar sesi (lebar panel, sidebar, tab, tema) di localStorage. */
export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      sidebarOpen: true,
      rightPanelOpen: false,
      rightPanelWidth: RIGHT_PANEL_DEFAULT,
      rightPanelTab: 'preview',
      paneTree: null,
      theme: 'system',
      reduceMotion: null,
      inAppToasts: true,
      paletteOpen: false,
      newChatSignal: 0,
      activeProjectId: null,
      activeRunBranch: null,
      reviewRunId: null,
      webSearch: false,
      setWebSearch: (webSearch) => set({ webSearch }),
      skillPacks: [],
      setSkillPacks: (skillPacks) => set({ skillPacks }),
      agentSteps: [],
      setAgentSteps: (agentSteps) => set({ agentSteps }),
      fileRequest: null,
      requestFile: (path) =>
        set((s) => ({ fileRequest: { path, nonce: (s.fileRequest?.nonce ?? 0) + 1 } })),
      model: null,
      setModel: (model) => set({ model }),
      activeRole: null,
      setActiveRole: (activeRole) => set({ activeRole }),
      attachments: [],
      addAttachment: (attachment) =>
        set((s) => ({
          attachments: [...s.attachments.filter((a) => a.id !== attachment.id), attachment],
        })),
      removeAttachment: (id) =>
        set((s) => ({ attachments: s.attachments.filter((a) => a.id !== id) })),
      clearAttachments: () => set({ attachments: [] }),
      openReview: (reviewRunId) =>
        set((s) => ({
          reviewRunId,
          rightPanelOpen: true,
          rightPanelTab: 'diff',
          paneTree: s.paneTree ? revealTab(s.paneTree, 'diff') : null,
        })),
      setReviewRunId: (reviewRunId) => set({ reviewRunId }),
      setActiveProject: (activeProjectId) => set({ activeProjectId, activeRunBranch: null }),
      setActiveRunBranch: (activeRunBranch) => set({ activeRunBranch }),
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
      openPanel: (rightPanelTab) =>
        set((s) => ({
          rightPanelOpen: true,
          rightPanelTab,
          paneTree: s.paneTree ? revealTab(s.paneTree, rightPanelTab) : null,
        })),
      setRightPanelWidth: (width) => set({ rightPanelWidth: clampPanelWidth(width) }),
      setRightPanelTab: (rightPanelTab) => set({ rightPanelTab }),
      splitPane: (leafId, direction) => {
        const tree = get().paneTree ?? {
          type: 'leaf' as const,
          id: ROOT_ID,
          tab: get().rightPanelTab,
        };
        set({
          paneTree: splitPane(tree, leafId, direction, { split: newPaneId(), leaf: newPaneId() }),
        });
      },
      closePane: (leafId) => {
        const tree = get().paneTree;
        if (!tree) return;
        const next = closePane(tree, leafId);
        // Tinggal satu pane: kembali ke mode tab tunggal, tab terakhir tetap tampil.
        if (next.type === 'leaf') set({ paneTree: null, rightPanelTab: next.tab });
        else set({ paneTree: next });
      },
      setPaneTab: (leafId, tab) => {
        const tree = get().paneTree;
        if (!tree) set({ rightPanelTab: tab });
        else set({ paneTree: setLeafTab(tree, leafId, tab) });
      },
      setPaneRatio: (splitId, ratio) => {
        const tree = get().paneTree;
        if (tree) set({ paneTree: setSplitRatio(tree, splitId, ratio) });
      },
      setTheme: (theme) => set({ theme }),
      setReduceMotion: (reduceMotion) => set({ reduceMotion }),
      setInAppToasts: (inAppToasts) => set({ inAppToasts }),
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
        paneTree: s.paneTree,
        activeProjectId: s.activeProjectId,
        model: s.model,
        webSearch: s.webSearch,
        theme: s.theme,
        reduceMotion: s.reduceMotion,
        inAppToasts: s.inAppToasts,
      }),
      // Nilai tersimpan yang rusak atau di luar batas dikembalikan ke aman.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<UiState>;
        return {
          ...current,
          ...p,
          rightPanelWidth: clampPanelWidth(p.rightPanelWidth ?? RIGHT_PANEL_DEFAULT),
          paneTree: parsePaneTree(p.paneTree),
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

/** Kurangi gerakan aplikasi: true/false = pilihan pengguna, null = ikuti sistem (tanpa atribut). */
export function applyReduceMotion(
  value: boolean | null,
  root: HTMLElement = document.documentElement,
): void {
  if (value === null) root.removeAttribute('data-reduce-motion');
  else root.setAttribute('data-reduce-motion', String(value));
}
