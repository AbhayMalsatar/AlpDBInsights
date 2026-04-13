import { useState } from 'react';
import {
  Plus, Pencil, Trash2, Check, X, SlidersHorizontal,
  Calendar, GitBranch, Package, Layers,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import type { DashboardTab, TabFilter } from '../../store/useAppStore';

interface Props {
  dashboardId: string;
}

export function BuilderSidebar({ dashboardId }: Props) {
  const {
    dashboards, activeTabId, setActiveTab,
    addTab, removeTab, updateTab, charts,
  } = useAppStore();

  const dashboard = dashboards.find((d) => d.id === dashboardId);
  const tabs = dashboard?.tabs ?? [];

  const [newTabName, setNewTabName]   = useState('');
  const [showNewInput, setShowNewInput] = useState(false);
  const [editingId, setEditingId]     = useState<string | null>(null);
  const [editName, setEditName]       = useState('');
  const [expandedFilter, setExpandedFilter] = useState<string | null>(null);

  const handleAddTab = () => {
    if (!newTabName.trim()) return;
    const tab: DashboardTab = {
      id: `tab-${Date.now()}`,
      name: newTabName.trim(),
      filters: {},
      gridCols: 'auto',
    };
    addTab(dashboardId, tab);
    setActiveTab(tab.id);
    setNewTabName('');
    setShowNewInput(false);
  };

  const handleRename = (tabId: string) => {
    if (!editName.trim()) return;
    updateTab(dashboardId, tabId, { name: editName.trim() });
    setEditingId(null);
  };

  const handleFilterChange = (tabId: string, key: keyof TabFilter, value: string) => {
    const tab = tabs.find((t) => t.id === tabId)!;
    updateTab(dashboardId, tabId, {
      filters: { ...tab.filters, [key]: value || undefined },
    });
  };

  return (
    <aside
      style={{
        width: 220,
        background: 'hsl(var(--nav-bg))',
        borderRight: '1px solid hsl(var(--nav-border))',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '14px 14px 10px',
          borderBottom: '1px solid hsl(var(--nav-border))',
        }}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Layers size={13} style={{ color: 'hsl(var(--nav-active))' }} />
            <span className="text-xs font-semibold tracking-wide" style={{ color: 'hsl(var(--nav-fg))' }}>
              TABS
            </span>
          </div>
          <button
            onClick={() => setShowNewInput((v) => !v)}
            className="p-1 rounded-lg transition-colors"
            style={{ color: 'hsl(var(--nav-muted))' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'hsl(var(--nav-fg))')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'hsl(var(--nav-muted))')}
            title="Add Tab"
          >
            <Plus size={14} />
          </button>
        </div>

        {showNewInput && (
          <div className="flex gap-1 anim-fade-up">
            <input
              className="input h-7 text-xs"
              style={{
                background: 'hsl(var(--nav-hover))',
                border: '1px solid hsl(var(--nav-border))',
                color: 'hsl(var(--nav-fg))',
                flex: 1,
              }}
              placeholder="Tab name…"
              value={newTabName}
              onChange={(e) => setNewTabName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddTab();
                if (e.key === 'Escape') { setShowNewInput(false); setNewTabName(''); }
              }}
              autoFocus
            />
            <button
              onClick={handleAddTab}
              className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{ background: 'hsl(var(--primary))', color: 'white' }}
            >
              <Check size={12} />
            </button>
            <button
              onClick={() => { setShowNewInput(false); setNewTabName(''); }}
              className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{ background: 'hsl(var(--nav-hover))', color: 'hsl(var(--nav-muted))' }}
            >
              <X size={12} />
            </button>
          </div>
        )}
      </div>

      {/* Tab list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
        {tabs.length === 0 && (
          <div className="text-center py-8">
            <p className="text-xs" style={{ color: 'hsl(var(--nav-muted))' }}>
              No tabs yet
            </p>
            <button
              onClick={() => setShowNewInput(true)}
              className="mt-2 text-xs underline"
              style={{ color: 'hsl(var(--nav-active))' }}
            >
              Add first tab
            </button>
          </div>
        )}

        {tabs.map((tab) => {
          const isActive  = activeTabId === tab.id;
          const isEditing = editingId === tab.id;
          const isFilterOpen = expandedFilter === tab.id;
          const tabCharts = charts.filter((c) => c.tabId === tab.id);

          return (
            <div key={tab.id} className="mb-1">
              {/* Tab row */}
              <div
                className="group flex items-center gap-1.5 px-2.5 py-2 rounded-lg cursor-pointer transition-all"
                style={{
                  background: isActive ? 'hsl(var(--nav-active-bg))' : 'transparent',
                }}
                onClick={() => { setActiveTab(tab.id); }}
                onMouseEnter={(e) => {
                  if (!isActive) (e.currentTarget as HTMLElement).style.background = 'hsl(var(--nav-hover))';
                }}
                onMouseLeave={(e) => {
                  if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent';
                }}
              >
                {isEditing ? (
                  <input
                    className="input h-6 text-xs flex-1"
                    style={{
                      background: 'hsl(var(--nav-hover))',
                      border: '1px solid hsl(var(--primary) / 0.5)',
                      color: 'hsl(var(--nav-fg))',
                    }}
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleRename(tab.id);
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    autoFocus
                  />
                ) : (
                  <span
                    className="flex-1 text-xs font-medium truncate"
                    style={{ color: isActive ? 'hsl(var(--nav-active))' : 'hsl(var(--nav-fg))' }}
                  >
                    {tab.name}
                  </span>
                )}

                {/* Chart count badge */}
                {tabCharts.length > 0 && !isEditing && (
                  <span
                    className="text-[10px] px-1.5 rounded-full font-semibold"
                    style={{
                      background: 'hsl(var(--primary) / 0.2)',
                      color: 'hsl(var(--nav-active))',
                    }}
                  >
                    {tabCharts.length}
                  </span>
                )}

                {/* Actions */}
                {isEditing ? (
                  <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => handleRename(tab.id)}>
                      <Check size={11} style={{ color: 'hsl(var(--success))' }} />
                    </button>
                    <button onClick={() => setEditingId(null)}>
                      <X size={11} style={{ color: 'hsl(var(--danger))' }} />
                    </button>
                  </div>
                ) : (
                  <div className="hidden group-hover:flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => {
                        setExpandedFilter(isFilterOpen ? null : tab.id);
                      }}
                      className="p-0.5 rounded"
                      style={{ color: 'hsl(var(--nav-muted))' }}
                      title="Filters"
                    >
                      <SlidersHorizontal size={11} />
                    </button>
                    <button
                      onClick={() => { setEditingId(tab.id); setEditName(tab.name); }}
                      className="p-0.5 rounded"
                      style={{ color: 'hsl(var(--nav-muted))' }}
                      title="Rename"
                    >
                      <Pencil size={11} />
                    </button>
                    <button
                      onClick={() => {
                        removeTab(dashboardId, tab.id);
                        if (activeTabId === tab.id) setActiveTab(null);
                      }}
                      className="p-0.5 rounded"
                      style={{ color: 'hsl(var(--nav-muted))' }}
                      title="Delete"
                      onMouseEnter={(e) => (e.currentTarget.style.color = 'hsl(var(--danger))')}
                      onMouseLeave={(e) => (e.currentTarget.style.color = 'hsl(var(--nav-muted))')}
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                )}
              </div>

              {/* Filter panel */}
              {isFilterOpen && (
                <div
                  className="mx-2 mb-2 rounded-lg p-2.5 anim-fade-up"
                  style={{
                    background: 'hsl(var(--nav-hover))',
                    border: '1px solid hsl(var(--nav-border))',
                  }}
                >
                  <div className="flex items-center gap-1.5 mb-2">
                    <SlidersHorizontal size={11} style={{ color: 'hsl(var(--nav-active))' }} />
                    <span className="text-[10px] font-semibold tracking-wide" style={{ color: 'hsl(var(--nav-muted))' }}>
                      FILTERS
                    </span>
                  </div>

                  {/* Date From */}
                  <div className="mb-2">
                    <label className="flex items-center gap-1 text-[10px] mb-1" style={{ color: 'hsl(var(--nav-muted))' }}>
                      <Calendar size={9} /> From Date
                    </label>
                    <input
                      type="date"
                      className="input h-6 text-[10px]"
                      style={{
                        background: 'hsl(var(--nav-bg))',
                        border: '1px solid hsl(var(--nav-border))',
                        color: 'hsl(var(--nav-fg))',
                      }}
                      value={tab.filters.dateFrom ?? ''}
                      onChange={(e) => handleFilterChange(tab.id, 'dateFrom', e.target.value)}
                    />
                  </div>

                  {/* Date To */}
                  <div className="mb-2">
                    <label className="flex items-center gap-1 text-[10px] mb-1" style={{ color: 'hsl(var(--nav-muted))' }}>
                      <Calendar size={9} /> To Date
                    </label>
                    <input
                      type="date"
                      className="input h-6 text-[10px]"
                      style={{
                        background: 'hsl(var(--nav-bg))',
                        border: '1px solid hsl(var(--nav-border))',
                        color: 'hsl(var(--nav-fg))',
                      }}
                      value={tab.filters.dateTo ?? ''}
                      onChange={(e) => handleFilterChange(tab.id, 'dateTo', e.target.value)}
                    />
                  </div>

                  {/* Branch */}
                  <div className="mb-2">
                    <label className="flex items-center gap-1 text-[10px] mb-1" style={{ color: 'hsl(var(--nav-muted))' }}>
                      <GitBranch size={9} /> Branch
                    </label>
                    <input
                      className="input h-6 text-[10px]"
                      style={{
                        background: 'hsl(var(--nav-bg))',
                        border: '1px solid hsl(var(--nav-border))',
                        color: 'hsl(var(--nav-fg))',
                      }}
                      placeholder="e.g. North"
                      value={tab.filters.branch ?? ''}
                      onChange={(e) => handleFilterChange(tab.id, 'branch', e.target.value)}
                    />
                  </div>

                  {/* Item */}
                  <div>
                    <label className="flex items-center gap-1 text-[10px] mb-1" style={{ color: 'hsl(var(--nav-muted))' }}>
                      <Package size={9} /> Item
                    </label>
                    <input
                      className="input h-6 text-[10px]"
                      style={{
                        background: 'hsl(var(--nav-bg))',
                        border: '1px solid hsl(var(--nav-border))',
                        color: 'hsl(var(--nav-fg))',
                      }}
                      placeholder="e.g. Laptop"
                      value={tab.filters.item ?? ''}
                      onChange={(e) => handleFilterChange(tab.id, 'item', e.target.value)}
                    />
                  </div>

                  {/* Active filters */}
                  {Object.values(tab.filters).some(Boolean) && (
                    <button
                      onClick={() => updateTab(dashboardId, tab.id, { filters: {} })}
                      className="mt-2 text-[10px] underline"
                      style={{ color: 'hsl(var(--danger))' }}
                    >
                      Clear all filters
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer — dashboard name */}
      <div
        style={{
          padding: '10px 14px',
          borderTop: '1px solid hsl(var(--nav-border))',
        }}
      >
        <p className="text-[10px] truncate" style={{ color: 'hsl(var(--nav-muted))' }}>
          {dashboard?.name ?? 'Dashboard'}
        </p>
      </div>
    </aside>
  );
}
