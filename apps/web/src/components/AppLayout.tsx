import { useEffect, useRef } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../features/auth/AuthContext';
import { Button } from './ui';

const navItems = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/providers', label: 'Provider LLM' },
  { to: '/agents', label: 'Agent Pekerja' },
  { to: '/tasks', label: 'Task & Log' },
  { to: '/settings', label: 'Pengaturan' }
];

export function AppLayout(): JSX.Element {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    mainRef.current?.focus();
  }, [location.pathname]);

  const onLogout = async (): Promise<void> => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-full bg-canvas md:flex">
      <a href="#main" className="sr-only">
        Lewati ke konten utama
      </a>
      <aside className="bg-ink text-white md:flex md:w-60 md:min-h-screen md:flex-col">
        <div className="px-5 py-4">
          <p className="text-lg font-extrabold tracking-tight">ORCA</p>
          <p className="text-xs text-slate-300">Agent Orchestrator</p>
        </div>
        <nav aria-label="Navigasi utama" className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:overflow-visible">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `whitespace-nowrap rounded px-3 py-2 text-sm font-medium ${
                  isActive ? 'bg-primary text-white' : 'text-slate-200 hover:bg-slate-700'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="hidden px-5 py-4 text-xs text-slate-400 md:mt-auto md:block">
          Chrome 93 compatible · v0.1.0
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-white px-4 py-3 lg:px-6">
          <div className="text-sm text-muted">
            Masuk sebagai <span className="font-semibold text-ink">{user?.name}</span>
            {user?.email ? <span className="ml-1">{` (${user.email})`}</span> : null}
          </div>
          <Button variant="secondary" onClick={() => void onLogout()}>
            Keluar
          </Button>
        </header>
        <main id="main" ref={mainRef} tabIndex={-1} className="p-4 outline-none lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
