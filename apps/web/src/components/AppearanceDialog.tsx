import { useState } from 'react';
import type { Appearance, SkinName } from '../lib/appearance';
import { SKINS } from '../lib/appearance';
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

  const pick = (next: SkinName): void => {
    setSkin(next);
    onChange({ ...appearance, skin: next });
    push('success', `Tema: ${SKINS.find((item) => item.id === next)?.name ?? next}`);
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
        Pilih tema warna. Preferensi tersimpan di perangkat dan mengikuti akun Anda.
      </p>
      <div className="skin-grid">
        {SKINS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`skin-card ${skin === item.id ? 'active' : ''}`}
            onClick={() => pick(item.id)}
          >
            <span className={`skin-swatch skin-${item.id}`} />
            <span className="skin-name">{item.name}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
