import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, MessageSquare, PanelRightClose } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { BuilderSidebar } from '../components/builder/BuilderSidebar';
import { BuilderCanvas } from '../components/builder/BuilderCanvas';
import { BuilderChat } from '../components/builder/BuilderChat';

export function BuilderPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const dashboardId = params.get('dashboardId') ?? '';
  const { dashboards, activeTabId, setActiveTab, theme } = useAppStore();
  const isDark = theme === 'dark';
  const [chatOpen, setChatOpen] = useState(true);

  const dashboard = dashboards.find((d) => d.id === dashboardId);

  /* Auto-select first tab that belongs to THIS dashboard.
     Without this, a stale activeTabId from another dashboard causes
     updateTab / setGridCols to silently do nothing. */
  useEffect(() => {
    if (!dashboard) return;
    const belongsHere = dashboard.tabs.some((t) => t.id === activeTabId);
    if (!belongsHere) {
      setActiveTab(dashboard.tabs.length ? dashboard.tabs[0].id : null);
    }
  }, [dashboardId, dashboard, activeTabId, setActiveTab]);

  if (!dashboardId || !dashboard) {
    return (
      <div
        className="flex flex-col items-center justify-center"
        style={{ height: 'calc(100vh - 56px)', background: 'hsl(var(--bg))' }}
      >
        <p className="text-sm mb-4" style={{ color: 'hsl(var(--fg-muted))' }}>
          Dashboard not found
        </p>
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2 text-sm btn-primary h-9 px-4 rounded-lg"
        >
          <ArrowLeft size={14} /> Back to Dashboards
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        height: 'calc(100vh - 56px)',
        display: 'flex',
        overflow: 'hidden',
        background: 'hsl(var(--bg))',
      }}
    >
      {/* Sidebar */}
      <BuilderSidebar dashboardId={dashboardId} />

      {/* Canvas */}
      <BuilderCanvas
        dashboardId={dashboardId}
        activeTabId={activeTabId}
        isDark={isDark}
        chatOpen={chatOpen}
        onToggleChat={() => setChatOpen(v => !v)}
      />

      {/* Chat panel — slides in/out */}
      <div style={{
        width: chatOpen ? 320 : 0,
        flexShrink: 0,
        overflow: 'hidden',
        transition: 'width 0.25s cubic-bezier(0.4,0,0.2,1)',
      }}>
        <BuilderChat dashboardId={dashboardId} activeTabId={activeTabId} />
      </div>

      {/* Floating open button when chat is hidden */}
      {!chatOpen && (
        <button
          onClick={() => setChatOpen(true)}
          title="Open AI Chat"
          style={{
            position: 'absolute',
            right: 16,
            bottom: 24,
            width: 44,
            height: 44,
            borderRadius: '50%',
            background: 'hsl(var(--primary))',
            color: 'white',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
            zIndex: 40,
            transition: 'transform 0.15s, box-shadow 0.15s',
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.transform = 'scale(1.08)';
            (e.currentTarget as HTMLElement).style.boxShadow = '0 6px 20px rgba(0,0,0,0.4)';
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
            (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 16px rgba(0,0,0,0.3)';
          }}
        >
          <MessageSquare size={20} />
        </button>
      )}
    </div>
  );
}
