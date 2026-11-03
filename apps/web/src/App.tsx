import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './features/auth/AuthContext';
import { ToastProvider } from './components/ToastProvider';
import { ProtectedLayout } from './components/ProtectedLayout';
import { LoginPage } from './routes/LoginPage';
import { DashboardPage } from './routes/DashboardPage';
import { ProvidersPage } from './routes/ProvidersPage';
import { AgentsPage } from './routes/AgentsPage';
import { TasksPage } from './routes/TasksPage';
import { TaskDetailPage } from './routes/TaskDetailPage';
import { SettingsPage } from './routes/SettingsPage';
import { NotFoundPage } from './routes/NotFoundPage';

export function App(): JSX.Element {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<ProtectedLayout />}>
              <Route index element={<DashboardPage />} />
              <Route path="/providers" element={<ProvidersPage />} />
              <Route path="/agents" element={<AgentsPage />} />
              <Route path="/tasks" element={<TasksPage />} />
              <Route path="/tasks/:id" element={<TaskDetailPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
