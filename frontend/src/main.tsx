import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './index.css';
import App from './App';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
});

/* Apply saved theme before first paint */
const stored = (() => {
  try {
    const raw = localStorage.getItem('insightdash-store');
    if (!raw) return 'dark';
    return (JSON.parse(raw) as { state?: { theme?: string } }).state?.theme ?? 'dark';
  } catch {
    return 'dark';
  }
})();
document.documentElement.classList.toggle('dark', stored === 'dark');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </BrowserRouter>
  </StrictMode>,
);
