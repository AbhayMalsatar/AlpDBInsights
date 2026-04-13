import { Routes, Route, Navigate } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { HomePage } from './pages/HomePage';
import { DatabasesPage } from './pages/DatabasesPage';
import { BuilderPage } from './pages/BuilderPage';

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/"          element={<HomePage />} />
        <Route path="/databases" element={<DatabasesPage />} />
        <Route path="/builder"   element={<BuilderPage />} />
        <Route path="*"          element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
