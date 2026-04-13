import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Plus, BarChart2, Database, Clock, Trash2,
  TrendingUp, Activity, ChevronRight, Wand2,
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import type { Dashboard } from '../store/useAppStore';

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

function NewDashboardModal({
  onClose, onCreate,
}: { onClose: () => void; onCreate: (name: string, desc: string) => void }) {
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={onClose}
    >
      <div
        className="card anim-scale-in"
        style={{ width: 420, padding: 28 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold mb-1" style={{ color: 'hsl(var(--fg))' }}>
          Create Dashboard
        </h2>
        <p className="text-xs mb-5" style={{ color: 'hsl(var(--fg-muted))' }}>
          Give your dashboard a name to get started
        </p>

        <div className="flex flex-col gap-3">
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'hsl(var(--fg-muted))' }}>
              Dashboard Name *
            </label>
            <input
              className="input"
              placeholder="e.g. Sales Performance Q1"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'hsl(var(--fg-muted))' }}>
              Description (optional)
            </label>
            <input
              className="input"
              placeholder="Brief description…"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
            />
          </div>
        </div>

        <div className="flex gap-2 mt-6">
          <button
            onClick={onClose}
            className="flex-1 h-9 rounded-lg text-xs font-medium"
            style={{
              background: 'hsl(var(--surface-raised))',
              border: '1px solid hsl(var(--border))',
              color: 'hsl(var(--fg-muted))',
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => name.trim() && onCreate(name.trim(), desc.trim())}
            disabled={!name.trim()}
            className="flex-1 h-9 rounded-lg text-xs font-semibold btn-primary"
            style={{ opacity: name.trim() ? 1 : 0.4 }}
          >
            Create Dashboard
          </button>
        </div>
      </div>
    </div>
  );
}

export function HomePage() {
  const navigate = useNavigate();
  const { dashboards, addDashboard, removeDashboard, charts, databases } = useAppStore();
  const [showModal, setShowModal] = useState(false);

  const stats = [
    {
      label: 'Total Dashboards', value: dashboards.length,
      icon: LayoutDashboard, color: 'hsl(var(--primary))',
    },
    {
      label: 'Total Charts', value: charts.length,
      icon: BarChart2, color: '#22c55e',
    },
    {
      label: 'Databases Connected', value: databases.filter(d => d.status === 'connected').length,
      icon: Database, color: '#f59e0b',
    },
    {
      label: 'Active Tabs', value: dashboards.reduce((acc, d) => acc + d.tabs.length, 0),
      icon: Activity, color: '#a78bfa',
    },
  ];

  const handleCreate = (name: string, desc: string) => {
    const id = `dash-${Date.now()}`;
    const newDash: Dashboard = {
      id,
      name,
      description: desc,
      tabs: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    addDashboard(newDash);
    setShowModal(false);
    navigate(`/builder?dashboardId=${id}`);
  };

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold mb-1" style={{ color: 'hsl(var(--fg))' }}>
            My Dashboards
          </h1>
          <p className="text-sm" style={{ color: 'hsl(var(--fg-muted))' }}>
            Build, explore, and manage your AI-powered dashboards
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="btn-primary flex items-center gap-2 h-9 px-4 rounded-lg text-sm font-medium"
        >
          <Plus size={15} />
          New Dashboard
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {stats.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium" style={{ color: 'hsl(var(--fg-muted))' }}>
                {label}
              </span>
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{ background: `${color}18` }}
              >
                <Icon size={15} style={{ color }} />
              </div>
            </div>
            <div className="text-2xl font-bold" style={{ color: 'hsl(var(--fg))' }}>
              {value}
            </div>
          </div>
        ))}
      </div>

      {/* Dashboards grid */}
      {dashboards.length === 0 ? (
        <div
          className="card flex flex-col items-center justify-center py-20"
          style={{ borderStyle: 'dashed' }}
        >
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
            style={{ background: 'hsl(var(--primary-light))' }}
          >
            <Wand2 size={22} style={{ color: 'hsl(var(--primary))' }} />
          </div>
          <h3 className="text-base font-semibold mb-1.5" style={{ color: 'hsl(var(--fg))' }}>
            No dashboards yet
          </h3>
          <p className="text-sm mb-6 text-center max-w-xs" style={{ color: 'hsl(var(--fg-muted))' }}>
            Create your first dashboard and start building charts with AI
          </p>
          <button
            onClick={() => setShowModal(true)}
            className="btn-primary flex items-center gap-2 h-9 px-5 rounded-lg text-sm font-medium"
          >
            <Plus size={15} />
            Create Dashboard
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {dashboards.map((dash) => {
            const tabCount = dash.tabs.length;
            const chartCount = charts.filter((c) => c.dashboardId === dash.id).length;
            return (
              <div
                key={dash.id}
                className="card card-hover anim-fade-up p-5"
                onClick={() => navigate(`/builder?dashboardId=${dash.id}`)}
              >
                <div className="flex items-start justify-between mb-3">
                  <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center"
                    style={{ background: 'hsl(var(--primary-muted))' }}
                  >
                    <LayoutDashboard size={16} style={{ color: 'hsl(var(--primary))' }} />
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeDashboard(dash.id);
                    }}
                    className="p-1.5 rounded-lg transition-colors"
                    style={{ color: 'hsl(var(--fg-subtle))' }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = 'hsl(var(--danger))')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = 'hsl(var(--fg-subtle))')}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>

                <h3 className="font-semibold text-sm mb-1" style={{ color: 'hsl(var(--fg))' }}>
                  {dash.name}
                </h3>
                {dash.description && (
                  <p className="text-xs mb-3 line-clamp-1" style={{ color: 'hsl(var(--fg-muted))' }}>
                    {dash.description}
                  </p>
                )}

                <div className="flex items-center gap-3 mt-3">
                  <span className="flex items-center gap-1 text-xs" style={{ color: 'hsl(var(--fg-subtle))' }}>
                    <TrendingUp size={11} />
                    {chartCount} charts
                  </span>
                  <span className="flex items-center gap-1 text-xs" style={{ color: 'hsl(var(--fg-subtle))' }}>
                    <Activity size={11} />
                    {tabCount} tabs
                  </span>
                  <span className="flex items-center gap-1 text-xs ml-auto" style={{ color: 'hsl(var(--fg-subtle))' }}>
                    <Clock size={11} />
                    {formatDate(dash.updatedAt)}
                  </span>
                </div>

                <div
                  className="flex items-center gap-1 mt-4 pt-3 text-xs font-medium"
                  style={{
                    borderTop: '1px solid hsl(var(--border))',
                    color: 'hsl(var(--primary))',
                  }}
                >
                  Open Builder
                  <ChevronRight size={12} />
                </div>
              </div>
            );
          })}

          {/* Add card */}
          <div
            className="card card-hover flex flex-col items-center justify-center py-10 cursor-pointer"
            style={{ borderStyle: 'dashed' }}
            onClick={() => setShowModal(true)}
          >
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center mb-3"
              style={{ background: 'hsl(var(--primary-light))' }}
            >
              <Plus size={18} style={{ color: 'hsl(var(--primary))' }} />
            </div>
            <span className="text-sm font-medium" style={{ color: 'hsl(var(--fg-muted))' }}>
              New Dashboard
            </span>
          </div>
        </div>
      )}

      {showModal && (
        <NewDashboardModal onClose={() => setShowModal(false)} onCreate={handleCreate} />
      )}
    </div>
  );
}
