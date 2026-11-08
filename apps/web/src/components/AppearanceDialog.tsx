import { useCallback, useEffect, useState } from 'react';
import type { PluginInfo } from '@dorado/shared';
import { ApiError, apiDelete, apiGet, apiPost } from '../lib/api';
import type { Appearance, LayoutName, SkinName } from '../lib/appearance';
import { LAYOUTS, SKINS } from '../lib/appearance';
import { Modal, useToast } from './ui';

export function AppearanceDialog({
  appearance,
  isAdmin,
  onChange,
  onPluginsChanged,
  onClose
}: {
  appearance: Appearance;
  isAdmin: boolean;
  onChange: (next: Appearance) => void;
  onPluginsChanged: () => void;
  onClose: () => void;
}): JSX.Element {
  const { push } = useToast();
  const [skin, setSkin] = useState<SkinName>(appearance.skin);
  const [layout, setLayout] = useState<LayoutName>(appearance.layout);
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [manifestText, setManifestText] = useState('');
  const [cssText, setCssText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const loadPlugins = useCallback(async (): Promise<void> => {
    try {
      const response = await apiGet<{ data: PluginInfo[] }>('/plugins');
      setPlugins(response.data);
    } catch {
      // abaikan
    }
  }, []);

  useEffect(() => {
    void loadPlugins();
  }, [loadPlugins]);

  const pickSkin = (next: SkinName): void => {
    setSkin(next);
    onChange({ ...appearance, skin: next });
  };

  const pickLayout = (next: LayoutName): void => {
    setLayout(next);
    onChange({ ...appearance, layout: next });
    push('success', `Layout: ${LAYOUTS.find((item) => item.id === next)?.name ?? next}`);
  };

  const install = async (): Promise<void> => {
    setPending(true);
    setError(null);
    try {
      const manifest = JSON.parse(manifestText) as Record<string, unknown>;
      await apiPost('/plugins', { manifest, css: cssText });
      push('success', 'Plugin terpasang.');
      setManifestText('');
      setCssText('');
      await loadPlugins();
      onPluginsChanged();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Plugin JSON tidak valid.');
    } finally {
      setPending(false);
    }
  };

  const remove = async (plugin: PluginInfo): Promise<void> => {
    if (!window.confirm(`Hapus plugin "${plugin.name}"?`)) return;
    try {
      await apiDelete(`/plugins/${plugin.id}`);
      push('success', 'Plugin dihapus.');
      if (skin === plugin.id) pickSkin('dorado-gold');
      await loadPlugins();
      onPluginsChanged();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Gagal menghapus plugin.');
    }
  };

  return (
    <Modal
      title="Tampilan & Tema"
      onClose={onClose}
      wide
      footer={
        <button className="btn" onClick={onClose}>
          Tutup
        </button>
      }
    >
      <p className="muted" style={{ marginTop: 0, fontSize: 11.5 }}>
        Pilih tema warna dan layout workspace. Preferensi tersimpan di perangkat dan mengikuti akun Anda.
      </p>
      {error ? <div className="error-banner">{error}</div> : null}

      <div className="section-label">Tema Warna</div>
      <div className="skin-grid">
        {SKINS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`skin-card ${skin === item.id ? 'active' : ''}`}
            onClick={() => pickSkin(item.id)}
          >
            <span className={`skin-swatch skin-${item.id}`} />
            <span className="skin-name">{item.name}</span>
          </button>
        ))}
        {plugins.map((plugin) => (
          <button
            key={plugin.id}
            type="button"
            className={`skin-card ${skin === plugin.id ? 'active' : ''}`}
            onClick={() => pickSkin(plugin.id)}
          >
            <span className="skin-swatch skin-plugin" />
            <span className="skin-name">
              {plugin.name} <span className="badge">plugin</span>
            </span>
          </button>
        ))}
      </div>

      <div className="section-label">Layout Workspace</div>
      <div className="skin-grid">
        {LAYOUTS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`skin-card ${layout === item.id ? 'active' : ''}`}
            onClick={() => pickLayout(item.id)}
          >
            <span className="skin-name">{item.name}</span>
            <span className="muted" style={{ fontSize: 10.5 }}>
              {item.hint}
            </span>
          </button>
        ))}
      </div>

      {isAdmin ? (
        <>
          <div className="section-label">Plugin & Tema Kustom ({plugins.length})</div>
          <div className="quick-command-list">
            {plugins.length === 0 ? <div className="empty">Belum ada plugin.</div> : null}
            {plugins.map((plugin) => (
              <div className="quick-command-row" key={plugin.id}>
                <div className="quick-command-info">
                  <div className="quick-command-label">
                    {plugin.name}
                    <span className="badge mono">{plugin.id}</span>
                    {plugin.version ? <span className="badge">{plugin.version}</span> : null}
                  </div>
                  <code className="quick-command-code">{plugin.vars.join(', ') || '(tanpa cssVars)'}</code>
                </div>
                <div className="quick-command-actions">
                  <button className="btn tiny ghost" onClick={() => void remove(plugin)}>
                    Hapus
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="orch-form">
            <div className="field">
              <label>Manifest (JSON)</label>
              <textarea
                className="textarea"
                rows={3}
                value={manifestText}
                onChange={(event) => setManifestText(event.target.value)}
                placeholder={'{"id":"neon","name":"Neon","cssVars":{"--accent":"#ff007f"}}'}
              />
            </div>
            <div className="field">
              <label>CSS tambahan (opsional)</label>
              <textarea
                className="textarea"
                rows={3}
                value={cssText}
                onChange={(event) => setCssText(event.target.value)}
                placeholder={'.badge { letter-spacing: 0.05em; }'}
              />
            </div>
            <div className="orch-form-actions">
              <button
                className="btn tiny primary"
                onClick={() => void install()}
                disabled={pending || !manifestText.trim()}
              >
                {pending ? 'Memasang...' : '+ Pasang Plugin'}
              </button>
            </div>
          </div>
        </>
      ) : null}
    </Modal>
  );
}
