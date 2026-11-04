import { createRoot } from 'react-dom/client';
import '@xterm/xterm/css/xterm.css';
import 'codemirror/lib/codemirror.css';
import './styles/index.css';
import { App } from './App';
import { ToastProvider } from './components/ui';

const container = document.getElementById('root');
if (!container) throw new Error('Elemen #root tidak ditemukan.');

createRoot(container).render(
  <ToastProvider>
    <App />
  </ToastProvider>
);
