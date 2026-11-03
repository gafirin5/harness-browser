import { Link } from 'react-router-dom';
import { EmptyState } from '../components/ui';

export function NotFoundPage(): JSX.Element {
  return (
    <div className="card">
      <EmptyState
        title="Halaman tidak ditemukan"
        description="Alamat yang Anda buka tidak tersedia di panel orkestrasi."
        action={
          <Link className="btn btn-primary" to="/">
            Kembali ke Dashboard
          </Link>
        }
      />
    </div>
  );
}
