import { useState } from 'react';
import type { Appearance, LayoutName, SkinName } from '../lib/appearance';
import { LAYOUTS, SKINS } from '../lib/appearance';
import { Modal, useToast } from './ui';

export function AppearanceDialog({
  appearance,
  onChange,
  onClose
}: {
  appearance: Appearance;
  onChange: (next: Appearance) => void;
  onClose: () => void;
}): JSX.Element {
  const { push } = useToast();
  const [skin, setSkin] = useState<SkinName>(appearance.skin);
  const [layout, setLayout] = useState<LayoutName>(appearance.layout);

  const pickSkin = (next: SkinName): void => {
    setSkin(next);
    onChange({ ...appearance, skin: next });
    push('success', `Tema: ${SKINS.find((item) => item.id === next)?.name ?? next}`);
  };

  const pickLayout = (next: LayoutName): void => {
    setLayout(next);
    onChange({ ...appearance, layout: next });
    push('success', `Layout: ${LAYOUTS.find((item) => item.id === next)?.name ?? next}`);
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
    </Modal>
  );
}
