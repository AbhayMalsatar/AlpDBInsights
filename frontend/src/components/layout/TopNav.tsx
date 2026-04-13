import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Database, Wand2, Sun, Moon, Zap } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';

const NAV_ITEMS = [
  { path: '/',          label: 'Dashboards', icon: LayoutDashboard },
  { path: '/databases', label: 'Databases',  icon: Database },
  { path: '/builder',   label: 'Builder',    icon: Wand2 },
];

export function TopNav() {
  const { pathname } = useLocation();
  const { theme, toggleTheme } = useAppStore();

  return (
    <header
      style={{
        background: 'hsl(var(--nav-bg))',
        borderBottom: '1px solid hsl(var(--nav-border))',
      }}
      className="fixed top-0 left-0 right-0 z-50 h-14 flex items-center px-5 gap-6"
    >
      {/* Logo */}
      <div className="flex items-center gap-2 mr-4">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ background: 'hsl(var(--primary))' }}
        >
          <Zap size={14} color="white" strokeWidth={2.5} />
        </div>
        <span
          className="text-sm font-bold tracking-tight"
          style={{ color: 'hsl(var(--nav-fg))' }}
        >
          InsightDash
        </span>
      </div>

      {/* Nav links */}
      <nav className="flex items-center gap-1 flex-1">
        {NAV_ITEMS.map(({ path, label, icon: Icon }) => {
          const isActive = path === '/'
            ? pathname === '/'
            : pathname.startsWith(path);
          return (
            <Link
              key={path}
              to={path}
              className="nav-link"
              style={{
                color: isActive ? 'hsl(var(--nav-active))' : 'hsl(var(--nav-muted))',
                background: isActive ? 'hsl(var(--nav-active-bg))' : 'transparent',
                width: 'auto',
              }}
            >
              <Icon size={15} />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Right actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={toggleTheme}
          className="nav-link"
          style={{ width: 'auto', padding: '7px', borderRadius: '8px' }}
          title="Toggle theme"
        >
          {theme === 'dark'
            ? <Sun size={15} />
            : <Moon size={15} />}
        </button>
      </div>
    </header>
  );
}
