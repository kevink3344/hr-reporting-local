import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Building2, Pin, Search, Trash2, X } from 'lucide-react';
import { deletePositionPin, getPositionPins } from './api';
import type { LoginSession, PositionPin, School } from './types';

export function PositionsPage({
  session,
  schools,
  onOpenPosition
}: {
  session: LoginSession | null;
  schools: School[];
  onOpenPosition: (posNumber: string, organization: string) => void;
}) {
  const [pins, setPins] = useState<PositionPin[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [orgFilter, setOrgFilter] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 25;

  async function load() {
    if (!session) return;
    setLoading(true);
    setError('');
    try {
      const res = await getPositionPins(session, {
        search: search.trim() || undefined,
        organization: orgFilter || undefined,
        page,
        pageSize
      });
      setPins(res.data);
      setTotal(res.total);
    } catch {
      setError('Could not load pinned positions.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [session, orgFilter, page]);

  // Debounced search
  useEffect(() => {
    const t = window.setTimeout(() => {
      setPage(1);
      void load();
    }, 300);
    return () => window.clearTimeout(t);
  }, [search]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  async function handleRemove(pin: PositionPin) {
    if (!session) return;
    try {
      await deletePositionPin(session, pin.id);
      setPins((prev) => prev.filter((p) => p.id !== pin.id));
      setTotal((t) => Math.max(0, t - 1));
    } catch {
      setError('Could not remove pinned position.');
    }
  }

  const orgOptions = useMemo(() => schools.map((s) => s.name), [schools]);

  return (
    <section className="positions-page">
      <div className="positions-header">
        <div>
          <p className="eyebrow">Positions</p>
          <h2>Your pinned positions</h2>
          <p className="positions-copy">Pin a position from its details screen to keep it here. Click a position to reopen its details.</p>
        </div>
        <span className="result-count">{total} {total === 1 ? 'position' : 'positions'}</span>
      </div>

      <div className="positions-toolbar">
        <label className="search-field positions-search">
          <Search size={16} aria-hidden="true" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by position number, title, or incumbent"
            aria-label="Search pinned positions"
          />
          {search && <button className="field-clear" onClick={() => setSearch('')} aria-label="Clear search"><X size={14} /></button>}
        </label>
        <label className="select-field">
          <Building2 size={16} aria-hidden="true" />
          <select value={orgFilter} onChange={(e) => { setOrgFilter(e.target.value); setPage(1); }}>
            <option value="">All organizations</option>
            {orgOptions.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
      </div>

      {error && <div className="notice error"><AlertCircle size={16} /><span>{error}</span></div>}

      {loading ? (
        <div className="empty-state"><span className="loader" />Loading positions</div>
      ) : pins.length === 0 ? (
        <div className="empty-state">
          <Pin size={28} />
          <h3>No pinned positions yet</h3>
          <p>Open a position's details and click the pin icon to keep it here.</p>
        </div>
      ) : (
        <>
          <div className="table-wrap positions-table-wrap">
            <table className="positions-table">
              <thead>
                <tr>
                  <th>Position no.</th>
                  <th>Title</th>
                  <th>Organization</th>
                  <th>Incumbent</th>
                  <th>Employee no.</th>
                  <th><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {pins.map((pin) => (
                  <tr key={pin.id}>
                    <td>
                      <button className="link-button positions-position-link" onClick={() => onOpenPosition(pin.posNumber, pin.organization)} title={`Open position ${pin.posNumber}`}>
                        <Pin size={13} className="positions-pin-inline" aria-hidden="true" />
                        <strong>{pin.posNumber}</strong>
                      </button>
                    </td>
                    <td>{pin.posName}</td>
                    <td>{pin.organization}</td>
                    <td>{pin.incumbentName || '—'}</td>
                    <td className="mono">{pin.employeeNumber || '—'}</td>
                    <td>
                      <button className="icon-button subtle" onClick={() => void handleRemove(pin)} aria-label={`Remove position ${pin.posNumber}`} title="Remove pinned position">
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="positions-cards">
            {pins.map((pin) => (
              <div key={pin.id} className="positions-card">
                <div className="positions-card-head">
                  <button className="link-button positions-position-link" onClick={() => onOpenPosition(pin.posNumber, pin.organization)}>
                    <Pin size={13} className="positions-pin-inline" />
                    <strong>{pin.posNumber}</strong>
                  </button>
                  <button className="icon-button subtle" onClick={() => void handleRemove(pin)} aria-label="Remove"><Trash2 size={15} /></button>
                </div>
                <div className="positions-card-title">{pin.posName}</div>
                <div className="positions-card-meta">
                  <span>{pin.organization}</span>
                  {pin.incumbentName && <span>{pin.incumbentName}</span>}
                  {pin.employeeNumber && <span className="mono">{pin.employeeNumber}</span>}
                </div>
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="positions-pagination">
              <button className="back-button" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</button>
              <span className="mono" style={{ fontSize: '13px' }}>Page {page} of {totalPages}</span>
              <button className="back-button" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next</button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
