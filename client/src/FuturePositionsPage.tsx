import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, ClipboardCheck, Clock, Lock, Pencil, Send, X } from 'lucide-react';
import { completeFuturePosition, getFuturePositions, sendNowFuturePosition } from './api';
import type { FuturePosition, FuturePositionStatus, LoginSession } from './types';

type Tab = 'pending' | 'locked' | 'completed';

function statusPill(status: FuturePositionStatus) {
  switch (status) {
    case 'pending': return <span className="status-pill status-pill--pending"><Clock size={13} />Pending</span>;
    case 'locked': return <span className="status-pill status-pill--locked"><Lock size={13} />Locked</span>;
    case 'completed': return <span className="status-pill status-pill--completed"><CheckCircle2 size={13} />Completed</span>;
  }
}

function errorMessage(failure: unknown, fallback: string): string {
  if (failure instanceof Error) {
    switch (failure.message) {
      case 'FORBIDDEN': return 'Data team access is required.';
      case 'FEATURE_DISABLED': return 'Future Positions is currently disabled.';
      case 'FUTURE_POSITION_NOT_FOUND': return 'The record no longer exists.';
      case 'FUTURE_POSITION_NOT_LOCKED': return 'This record is not locked yet. It can only be completed after the one-hour review window closes.';
      default: return failure.message.startsWith('HTTP_') ? fallback : failure.message;
    }
  }
  return fallback;
}

export function FuturePositionsPage({
  session,
  onOpenPosition
}: {
  session: LoginSession;
  onOpenPosition: (posNumber: string, organization: string) => void;
}) {
  const [tab, setTab] = useState<Tab>('pending');
  const [items, setItems] = useState<FuturePosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const list = await getFuturePositions(session);
      setItems(list);
    } catch (failure) {
      setError(errorMessage(failure, 'The pending positions could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => { void load(); }, [load]);

  const grouped = useMemo(() => {
    const filtered = items.filter((item) => item.status === tab);
    const map = new Map<string, FuturePosition[]>();
    for (const item of filtered) {
      const org = item.organization || '(unknown)';
      const bucket = map.get(org) ?? [];
      bucket.push(item);
      map.set(org, bucket);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [items, tab]);

  async function complete(id: string) {
    if (busyId) return;
    setBusyId(id);
    setError('');
    try {
      await completeFuturePosition(session, id);
      await load();
    } catch (failure) {
      setError(errorMessage(failure, 'The record could not be completed.'));
    } finally {
      setBusyId(null);
    }
  }

  async function sendNow(id: string) {
    if (busyId) return;
    setBusyId(id);
    setError('');
    try {
      await sendNowFuturePosition(session, id);
      await load();
    } catch (failure) {
      setError(errorMessage(failure, 'The record could not be updated.'));
    } finally {
      setBusyId(null);
    }
  }

  const counts = useMemo(() => ({
    pending: items.filter((item) => item.status === 'pending').length,
    locked: items.filter((item) => item.status === 'locked').length,
    completed: items.filter((item) => item.status === 'completed').length
  }), [items]);

  return <section className="reports-page" aria-labelledby="future-title">
    <div className="reports-page-heading">
      <div>
        <p className="eyebrow">Data team</p>
        <h2 id="future-title">Future Positions.</h2>
        <p className="reports-intro">Review staged incumbents as they are submitted. Pending records can be edited by staff for one hour; locked records are ready for your review. Complete a record once it is verified.</p>
      </div>
    </div>

    {error && <div className="notice error"><AlertCircle size={18} /><span>{error}</span></div>}

    <div className="settings-tabs" role="tablist">
      <button role="tab" aria-selected={tab === 'pending'} className={tab === 'pending' ? 'settings-tab active' : 'settings-tab'} onClick={() => setTab('pending')}>Pending ({counts.pending})</button>
      <button role="tab" aria-selected={tab === 'locked'} className={tab === 'locked' ? 'settings-tab active' : 'settings-tab'} onClick={() => setTab('locked')}>Locked ({counts.locked})</button>
      <button role="tab" aria-selected={tab === 'completed'} className={tab === 'completed' ? 'settings-tab active' : 'settings-tab'} onClick={() => setTab('completed')}>Completed ({counts.completed})</button>
    </div>

    {loading ? (
      <div className="empty-state"><span className="loader" />Loading future positions</div>
    ) : grouped.length === 0 ? (
      <div className="empty-state"><ClipboardCheck size={26} /><p>No {tab} positions right now.</p></div>
    ) : (
      grouped.map(([org, orgItems]) => (
        <div key={org} className="future-position-group">
          <h3 className="future-position-org">{org} <span className="future-position-org-count">({orgItems.length})</span></h3>
          <div className="future-position-list">
            {orgItems.map((item) => (
              <article key={item.id} className="future-position-card">
                <div className="future-position-card-head">
                  <div>
                    <strong className="future-position-card-title">{item.posName || `Position ${item.posNumber}`}</strong>
                    <span className="future-position-card-meta">#{item.posNumber} · {item.organization}</span>
                  </div>
                  {statusPill(item.status)}
                </div>
                <dl className="future-position-card-grid">
                  <div><dt>New incumbent</dt><dd>{item.incumbentName || '—'}</dd></div>
                  <div><dt>Employee no.</dt><dd>{item.employeeNumber || '—'}</dd></div>
                  <div><dt>Position type</dt><dd>{item.positionType}</dd></div>
                  <div><dt>Effective date</dt><dd>{item.hireDate || '—'}</dd></div>
                  <div><dt>Classroom</dt><dd>{item.classroomAssigned || '—'}</dd></div>
                  <div><dt>Account</dt><dd>{item.accountNumber || '—'}</dd></div>
                  <div><dt>Contract type</dt><dd>{item.contractType || '—'}</dd></div>
                  <div><dt>Contract start</dt><dd>{item.contractStartDate || '—'}</dd></div>
                  <div><dt>Contract end</dt><dd>{item.contractEndDate || '—'}</dd></div>
                  <div><dt>Letter needed</dt><dd>{item.letterNeeded || '—'}</dd></div>
                  <div><dt>Submitted by</dt><dd>{item.submittedByName}</dd></div>
                </dl>
                {item.notes && <p className="future-position-card-notes">{item.notes}</p>}
                <div className="future-position-card-actions">
                  <button className="back-button" onClick={() => onOpenPosition(item.posNumber, item.organization)}><Pencil size={14} />Open position</button>
                  {tab === 'locked' && (
                    <button className="export-button" disabled={busyId === item.id} onClick={() => void complete(item.id)}><CheckCircle2 size={14} />Complete</button>
                  )}
                  {tab === 'pending' && (
                    <button className="export-button" disabled={busyId === item.id} onClick={() => void sendNow(item.id)}><Send size={14} />Send now</button>
                  )}
                </div>
              </article>
            ))}
          </div>
        </div>
      ))
    )}
  </section>;
}
