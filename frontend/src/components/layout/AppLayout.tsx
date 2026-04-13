import { Outlet } from 'react-router-dom';
import { TopNav } from './TopNav';

export function AppLayout() {
  return (
    <div style={{ minHeight: '100vh', background: 'hsl(var(--bg))' }}>
      <TopNav />
      <main style={{ paddingTop: '56px' }}>
        <Outlet />
      </main>
    </div>
  );
}
