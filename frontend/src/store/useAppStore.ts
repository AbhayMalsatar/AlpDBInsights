import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/* ─── Types ─────────────────────────────────────────────────── */

export type ChartType = 'bar' | 'line' | 'pie' | 'area' | 'scatter' | 'table' | 'kpi';

export interface ChartData {
  id: string;
  title: string;
  type: ChartType;
  query?: string;
  data: Record<string, unknown>[];
  columns?: string[];
  xKey?: string;
  yKey?: string;
  order: number;
  tabId: string;
  dashboardId: string;
  createdAt: string;
  /** Column span for this individual chart: 1 | 2 | 3 */
  gridSpan?: 1 | 2 | 3;
}

export interface TabFilter {
  dateFrom?: string;
  dateTo?: string;
  branch?: string;
  item?: string;
}

export type GridMode = 'auto' | 1 | 2 | 3;

export interface DashboardTab {
  id: string;
  name: string;
  filters: TabFilter;
  /** How many charts per row. 'auto' = pick based on chart count. */
  gridCols: GridMode;
}

export interface Dashboard {
  id: string;
  name: string;
  description?: string;
  tabs: DashboardTab[];
  createdAt: string;
  updatedAt: string;
  chartsCount?: number;
}

/* ── Schema types (mirror backend models) ── */
export interface ColumnInfo {
  name: string;
  data_type: string;
  nullable: boolean;
  primary_key: boolean;
  foreign_key?: string | null;
  indexed?: boolean;
}

export interface TableInfo {
  table_name: string;
  columns: ColumnInfo[];
  row_count?: number | null;
}

export interface ViewInfo {
  view_name: string;
  columns: ColumnInfo[];
}

export interface ProcedureInfo {
  name: string;
  type: string;
  return_type?: string | null;
  parameters?: string;
}

export interface DatabaseConnection {
  id: string;
  name: string;
  type: 'postgresql' | 'mssql';
  host: string;
  port: number;
  database: string;
  username: string;
  status: 'connected' | 'error' | 'connecting';
  connectedAt?: string;
  tablesCount?: number;
  viewsCount?: number;
  proceduresCount?: number;
  /* full schema — populated on connect and on demand */
  tables?: TableInfo[];
  views?: ViewInfo[];
  procedures?: ProcedureInfo[];
  /** User-selected tables from Databases page popup */
  selectedTables?: string[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  chartId?: string;
  /** Clickable suggestion chips shown below the message */
  suggestions?: string[];
  /** Controls styling: chart | clarification | error | info | greeting | thanks | help */
  messageType?: string;
  /** Estimated token usage from backend per request */
  tokenUsage?: {
    query_tokens: number;
    schema_tokens: number;
    prompt_tokens: number;
    sql_tokens: number;
    total_estimated_tokens: number;
    budget_tokens: number;
  };
}

/* ─── Store ──────────────────────────────────────────────────── */

interface AppState {
  // Theme
  theme: 'dark' | 'light';
  toggleTheme: () => void;

  // Databases
  databases: DatabaseConnection[];
  addDatabase: (db: DatabaseConnection) => void;
  removeDatabase: (id: string) => void;
  updateDatabase: (id: string, updates: Partial<DatabaseConnection>) => void;

  // Dashboards
  dashboards: Dashboard[];
  activeDashboardId: string | null;
  addDashboard: (d: Dashboard) => void;
  removeDashboard: (id: string) => void;
  setActiveDashboard: (id: string | null) => void;

  // Tabs (within active dashboard)
  activeTabId: string | null;
  setActiveTab: (id: string | null) => void;
  addTab: (dashboardId: string, tab: DashboardTab) => void;
  removeTab: (dashboardId: string, tabId: string) => void;
  updateTab: (dashboardId: string, tabId: string, updates: Partial<DashboardTab>) => void;

  // Charts
  charts: ChartData[];
  addChart: (chart: ChartData) => void;
  removeChart: (id: string) => void;
  updateChart: (id: string, updates: Partial<ChartData>) => void;
  reorderCharts: (tabId: string, orderedIds: string[]) => void;

  // Chat
  chatMessages: ChatMessage[];
  addChatMessage: (msg: ChatMessage) => void;
  clearChat: (dashboardId: string) => void;
  activeDatabaseId: string | null;
  setActiveDatabaseId: (id: string | null) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      /* ── Theme ── */
      theme: 'dark',
      toggleTheme: () =>
        set((s) => {
          const next = s.theme === 'dark' ? 'light' : 'dark';
          document.documentElement.classList.toggle('dark', next === 'dark');
          return { theme: next };
        }),

      /* ── Databases ── */
      databases: [],
      addDatabase: (db) => set((s) => ({ databases: [...s.databases, db] })),
      removeDatabase: (id) =>
        set((s) => ({ databases: s.databases.filter((d) => d.id !== id) })),
      updateDatabase: (id, updates) =>
        set((s) => ({
          databases: s.databases.map((d) => (d.id === id ? { ...d, ...updates } : d)),
        })),

      /* ── Dashboards ── */
      dashboards: [],
      activeDashboardId: null,
      addDashboard: (d) => set((s) => ({ dashboards: [...s.dashboards, d] })),
      removeDashboard: (id) =>
        set((s) => ({ dashboards: s.dashboards.filter((d) => d.id !== id) })),
      setActiveDashboard: (id) => set({ activeDashboardId: id }),

      /* ── Tabs ── */
      activeTabId: null,
      setActiveTab: (id) => set({ activeTabId: id }),
      addTab: (dashboardId, tab) =>
        set((s) => ({
          dashboards: s.dashboards.map((d) =>
            d.id === dashboardId ? { ...d, tabs: [...d.tabs, tab] } : d,
          ),
        })),
      removeTab: (dashboardId, tabId) =>
        set((s) => ({
          dashboards: s.dashboards.map((d) =>
            d.id === dashboardId
              ? { ...d, tabs: d.tabs.filter((t) => t.id !== tabId) }
              : d,
          ),
        })),
      updateTab: (dashboardId, tabId, updates) =>
        set((s) => ({
          dashboards: s.dashboards.map((d) =>
            d.id === dashboardId
              ? {
                  ...d,
                  tabs: d.tabs.map((t) => (t.id === tabId ? { ...t, ...updates } : t)),
                }
              : d,
          ),
        })),

      /* ── Charts ── */
      charts: [],
      addChart: (chart) => set((s) => ({ charts: [...s.charts, chart] })),
      removeChart: (id) =>
        set((s) => ({ charts: s.charts.filter((c) => c.id !== id) })),
      updateChart: (id, updates) =>
        set((s) => ({
          charts: s.charts.map((c) => (c.id === id ? { ...c, ...updates } : c)),
        })),
      reorderCharts: (tabId, orderedIds) =>
        set((s) => ({
          charts: s.charts.map((c) => {
            if (c.tabId !== tabId) return c;
            const idx = orderedIds.indexOf(c.id);
            return idx !== -1 ? { ...c, order: idx } : c;
          }),
        })),

      /* ── Chat ── */
      chatMessages: [],
      addChatMessage: (msg) =>
        set((s) => ({ chatMessages: [...s.chatMessages, msg] })),
      clearChat: (dashboardId) =>
        set((s) => ({
          chatMessages: s.chatMessages.filter(
            (m) => !m.id.startsWith(dashboardId),
          ),
        })),
      activeDatabaseId: null,
      setActiveDatabaseId: (id) => set({ activeDatabaseId: id }),
    }),
    {
      name: 'insightdash-store',
      onRehydrateStorage: () => (state) => {
        if (state) {
          document.documentElement.classList.toggle(
            'dark',
            state.theme === 'dark',
          );
        }
      },
    },
  ),
);
