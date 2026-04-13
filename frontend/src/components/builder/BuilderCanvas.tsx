import {
  DndContext, closestCenter, PointerSensor,
  useSensor, useSensors, DragOverlay,
} from '@dnd-kit/core';
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy } from '@dnd-kit/sortable';
import { useState } from 'react';
import { BarChart2, LayoutGrid, Wand2, Sparkles, MessageSquare, PanelRightClose } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import type { GridMode } from '../../store/useAppStore';
import { ChartCard } from './ChartCard';

interface Props {
  dashboardId: string;
  activeTabId: string | null;
  isDark: boolean;
  chatOpen?: boolean;
  onToggleChat?: () => void;
}

/* Auto grid: pick best column count from chart count */
function resolveAutoGrid(chartCount: number): 1 | 2 | 3 {
  if (chartCount <= 1) return 1;
  if (chartCount === 2) return 2;
  return 3;
}

const GRID_OPTIONS: { value: GridMode; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 1,      label: '1'    },
  { value: 2,      label: '2'    },
  { value: 3,      label: '3'    },
];

export function BuilderCanvas({ dashboardId, activeTabId, isDark, chatOpen = true, onToggleChat }: Props) {
  const { charts, reorderCharts, dashboards, updateTab } = useAppStore();
  const [dragId, setDragId] = useState<string | null>(null);

  const dashboard = dashboards.find((d) => d.id === dashboardId);
  const activeTab = dashboard?.tabs.find((t) => t.id === activeTabId);

  const tabCharts = charts
    .filter((c) => c.tabId === activeTabId)
    .sort((a, b) => a.order - b.order);

  const dragChart = dragId ? tabCharts.find((c) => c.id === dragId) : null;

  /* Resolve actual column count from mode */
  const gridMode: GridMode = activeTab?.gridCols ?? 'auto';
  const activeCols: 1 | 2 | 3 =
    gridMode === 'auto' ? resolveAutoGrid(tabCharts.length) : gridMode;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const handleDragStart = ({ active }: DragStartEvent) => setDragId(String(active.id));

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setDragId(null);
    if (!over || active.id === over.id || !activeTabId) return;
    const ids  = tabCharts.map((c) => c.id);
    const from = ids.indexOf(String(active.id));
    const to   = ids.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    const reordered = [...ids];
    reordered.splice(from, 1);
    reordered.splice(to, 0, String(active.id));
    reorderCharts(activeTabId, reordered);
  };

  const setGridMode = (mode: GridMode) => {
    if (!activeTabId) return;
    updateTab(dashboardId, activeTabId, { gridCols: mode });
  };

  /* ── No tab selected ── */
  if (!activeTabId) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ background: 'hsl(var(--bg))' }}>
        <div className="text-center">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4"
            style={{ background: 'hsl(var(--primary-light))' }}>
            <LayoutGrid size={22} style={{ color: 'hsl(var(--primary))' }} />
          </div>
          <h3 className="text-sm font-semibold mb-1.5" style={{ color: 'hsl(var(--fg))' }}>
            Select or create a tab
          </h3>
          <p className="text-xs" style={{ color: 'hsl(var(--fg-muted))' }}>
            Use the sidebar to create a dashboard tab
          </p>
        </div>
      </div>
    );
  }

  /* ── No charts ── */
  if (tabCharts.length === 0) {
    return (
      <div className="flex-1 flex flex-col" style={{ background: 'hsl(var(--bg))' }}>
        <CanvasBar
          tabName={activeTab?.name}
          gridMode={gridMode}
          activeCols={activeCols}
          onGridChange={setGridMode}
          chatOpen={chatOpen}
          onToggleChat={onToggleChat}
        />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4"
              style={{ background: 'hsl(var(--primary-light))' }}>
              <Wand2 size={22} style={{ color: 'hsl(var(--primary))' }} />
            </div>
            <h3 className="text-sm font-semibold mb-1.5" style={{ color: 'hsl(var(--fg))' }}>
              No charts yet
            </h3>
            <p className="text-xs max-w-xs" style={{ color: 'hsl(var(--fg-muted))' }}>
              Ask the AI to create charts. Try: "Show top 10 products by revenue"
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden" style={{ background: 'hsl(var(--bg))' }}>
      <CanvasBar
        tabName={activeTab?.name}
        chartsCount={tabCharts.length}
        gridMode={gridMode}
        activeCols={activeCols}
        onGridChange={setGridMode}
        chatOpen={chatOpen}
        onToggleChat={onToggleChat}
      />

      {/* Scrollable canvas — fixed chart height so charts are always readable */}
      <div className="flex-1 overflow-y-auto p-4">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={tabCharts.map((c) => c.id)} strategy={rectSortingStrategy}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${activeCols}, 1fr)`,
                gridAutoRows: '360px',
                gap: 14,
                width: '100%',
              }}
            >
              {tabCharts.map((chart) => (
                <ChartCard key={chart.id} chart={chart} isDark={isDark} />
              ))}
            </div>
          </SortableContext>

          <DragOverlay>
            {dragChart && (
              <div className="dnd-drag-overlay card" style={{ pointerEvents: 'none', opacity: 0.9, height: 360 }}>
                <div className="flex items-center gap-2 px-3 py-2.5"
                  style={{ borderBottom: '1px solid hsl(var(--border))' }}>
                  <BarChart2 size={13} style={{ color: 'hsl(var(--primary))' }} />
                  <span className="text-xs font-semibold truncate" style={{ color: 'hsl(var(--fg))' }}>
                    {dragChart.title}
                  </span>
                </div>
              </div>
            )}
          </DragOverlay>
        </DndContext>
      </div>
    </div>
  );
}

/* ── Canvas Top Bar ────────────────────────────────────────────── */
function CanvasBar({
  tabName, chartsCount, gridMode, activeCols, onGridChange, chatOpen, onToggleChat,
}: {
  tabName?: string;
  chartsCount?: number;
  gridMode: GridMode;
  activeCols: 1 | 2 | 3;
  onGridChange: (v: GridMode) => void;
  chatOpen?: boolean;
  onToggleChat?: () => void;
}) {
  return (
    <div
      className="flex items-center gap-3 px-4 py-2.5 flex-shrink-0"
      style={{ borderBottom: '1px solid hsl(var(--border))', background: 'hsl(var(--surface))' }}
    >
      {/* Tab name + count */}
      {tabName && (
        <span className="text-xs font-semibold" style={{ color: 'hsl(var(--fg))' }}>
          {tabName}
        </span>
      )}
      {chartsCount !== undefined && (
        <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
          style={{ background: 'hsl(var(--primary-muted))', color: 'hsl(var(--primary))' }}>
          {chartsCount} chart{chartsCount !== 1 ? 's' : ''}
        </span>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Row layout controller */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-medium" style={{ color: 'hsl(var(--fg-subtle))' }}>
          Charts per row:
        </span>

        <div className="flex items-center rounded-lg overflow-hidden"
          style={{ border: '1px solid hsl(var(--border))' }}>
          {GRID_OPTIONS.map(({ value, label }) => {
            const isActive = gridMode === value;
            const isAuto   = value === 'auto';
            return (
              <button
                key={String(value)}
                onClick={() => onGridChange(value)}
                className="flex items-center gap-1 h-7 px-3 text-[11px] font-semibold transition-all"
                title={
                  isAuto
                    ? `Auto (currently ${activeCols} col${activeCols > 1 ? 's' : ''} based on ${chartsCount ?? 0} charts)`
                    : `${value} chart${Number(value) > 1 ? 's' : ''} per row`
                }
                style={{
                  background: isActive ? 'hsl(var(--primary))' : 'transparent',
                  color:      isActive ? 'white' : 'hsl(var(--fg-muted))',
                  borderRight: value !== 3 ? '1px solid hsl(var(--border))' : 'none',
                }}
              >
                {isAuto && <Sparkles size={9} style={{ flexShrink: 0 }} />}
                {label}
              </button>
            );
          })}
        </div>

        {/* Show what Auto resolved to */}
        {gridMode === 'auto' && chartsCount !== undefined && (
          <span className="text-[10px]" style={{ color: 'hsl(var(--fg-subtle))' }}>
            → {activeCols} col{activeCols > 1 ? 's' : ''}
          </span>
        )}

        {/* Chat toggle */}
        {onToggleChat && (
          <button
            onClick={onToggleChat}
            title={chatOpen ? 'Hide AI Chat' : 'Show AI Chat'}
            className="flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-[11px] font-medium transition-all"
            style={{
              background: chatOpen ? 'hsl(var(--primary-muted))' : 'hsl(var(--surface-raised))',
              border: `1px solid ${chatOpen ? 'hsl(var(--primary) / 0.4)' : 'hsl(var(--border))'}`,
              color: chatOpen ? 'hsl(var(--primary))' : 'hsl(var(--fg-muted))',
              marginLeft: 4,
            }}
          >
            {chatOpen
              ? <><PanelRightClose size={12} /> Hide Chat</>
              : <><MessageSquare size={12} /> Show Chat</>}
          </button>
        )}
      </div>
    </div>
  );
}
