import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Database, History, HardDrive, RefreshCw, TriangleAlert } from 'lucide-react';
import { getSystemInfo } from './api';
import type { LoginSession, SnapshotReading, SystemInfoPayload, SystemInfoRow } from './types';

// Admin-only System Information page.
//
// The question this page answers: "the reporting tables are reloaded every
// night — did a load land, and what changed?" The reporting database keeps no
// history of it (no load timestamp, no audit table, no auto_increment), so the
// server records its own baseline in a small JSON snapshot and this page reads
// that: the newest reading taken on a previous day, next to the live tables
// measured just now.
//
// So the first day has nothing to compare against by design — the reading taken
// today becomes tomorrow's baseline. Counts alone cannot tell a reload from an
// addition, which is why each reading also fingerprints every table.

/** `2026-09-02T23:30:01.000Z` -> `09/02`. */
function shortDate(stamp: string | null | undefined): string {
  if (!stamp || stamp.length < 10) return '—';
  return `${stamp.slice(5, 7)}/${stamp.slice(8, 10)}`;
}

function stampLabel(stamp: string | null | undefined): string {
  if (!stamp) return '—';
  const date = `${stamp.slice(5, 7)}/${stamp.slice(8, 10)}/${stamp.slice(2, 4)}`;
  const time = stamp.length >= 19 ? stamp.slice(11, 19) : '';
  return time ? `${date} ${time}` : date;
}

function count(value: number | null): string {
  return value === null ? '—' : value.toLocaleString('en-US');
}

function signed(value: number | null): string {
  if (value === null) return '—';
  if (value === 0) return '0';
  return `${value > 0 ? '+' : '−'}${Math.abs(value).toLocaleString('en-US')}`;
}

function signedPct(value: number | null): string {
  if (value === null) return '—';
  const text = `${Math.abs(value).toFixed(2)}%`;
  if (value === 0) return text;
  return `${value > 0 ? '+' : '−'}${text}`;
}

function readingTotal(reading: SnapshotReading | null): number | null {
  if (!reading) return null;
  return Object.values(reading.counts).reduce((sum, value) => sum + value, 0);
}

type Attention = 'empty' | 'large' | 'reloaded' | 'static' | null;

/**
 * Why a row is called out. Deliberately explainable, not a scoring model:
 *  - empty    — one side counted rows and the other is empty, which almost
 *               always means a load wrote nothing.
 *  - large    — the count moved by 1% or more since the baseline. One night of
 *               ordinary churn is well under that.
 *  - reloaded — the count is unchanged but the rows are not: the table was
 *               reloaded in place, which a count alone can never show.
 *  - static   — neither the count nor the contents moved while every other
 *               table did, which is worth a look at the loader.
 */
function attentionFor(row: SystemInfoRow, anyMoved: boolean): Attention {
  if (row.baselineCount === null || row.liveCount === null) return null;
  if ((row.baselineCount === 0) !== (row.liveCount === 0)) return 'empty';
  if (row.deltaPct !== null && Math.abs(row.deltaPct) >= 1) return 'large';
  if (row.delta === 0 && row.contentChanged === true) return 'reloaded';
  if (row.delta === 0 && row.contentChanged === false && anyMoved) return 'static';
  return null;
}

const ATTENTION_COPY: Record<Exclude<Attention, null>, string> = {
  empty: 'One side counted rows and the other is empty — check the load.',
  large: 'Moved 1% or more since the baseline. One night of ordinary churn is well under that.',
  reloaded: 'Same row count as the baseline, different rows — the table was reloaded in place.',
  static: 'Neither the count nor the contents moved while every other table did.'
};

export function SystemInfoPage({ session }: { session: LoginSession }) {
  const [data, setData] = useState<SystemInfoPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    getSystemInfo(session)
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch((failure: unknown) => {
        if (cancelled) return;
        setError(
          failure instanceof Error && failure.message === 'FEATURE_DISABLED'
            ? 'System Information is disabled. Turn it back on from the Features page.'
            : failure instanceof Error && (failure.name === 'TimeoutError' || failure.name === 'AbortError')
              ? 'The system information took too long to measure. A reporting table is probably locked by a long-running query — try again shortly.'
              : 'The system information could not be loaded.'
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.user.id]);

  if (loading) {
    return (
      <section className="reports-page">
        <div className="empty-state"><span className="loader" />Loading system information</div>
      </section>
    );
  }

  if (error || !data) {
    return (
      <section className="reports-page">
        <div className="notice error"><AlertCircle size={18} /><span>{error || 'No data was returned.'}</span></div>
      </section>
    );
  }

  const baseline = data.baseline;
  const measuredAt = new Date(data.generatedAt);
  const measuredLabel = Number.isNaN(measuredAt.getTime())
    ? '—'
    : `${String(measuredAt.getMonth() + 1).padStart(2, '0')}/${String(measuredAt.getDate()).padStart(2, '0')}/${String(measuredAt.getFullYear()).slice(-2)} ${measuredAt.toTimeString().slice(0, 8)}`;
  const anyMoved = data.rows.some((row) => row.delta !== null && row.delta !== 0);
  const flagged = data.rows.filter((row) => attentionFor(row, anyMoved) !== null);
  const reloaded = data.rows.filter((row) => row.contentChanged === true).length;

  return (
    <section className="reports-page" aria-labelledby="system-info-title">
      <div className="reports-page-heading">
        <div>
          <p className="eyebrow">Admin</p>
          <h2 id="system-info-title">System information.</h2>
          <p className="reports-intro">
            The reporting tables are reloaded every night, and the database keeps no record of it — no load
            timestamp, no history table. So this page keeps its own baseline: one reading a day, compared with the
            live row counts. It shows what moved overnight, including reloads that replaced rows without changing
            the count.
          </p>
        </div>
        <div className="report-count">
          <div className="report-count-head"><RefreshCw size={16} /><span>Tables checked</span></div>
          <strong>{data.rows.length}</strong>
          <span>measured {measuredLabel}</span>
        </div>
      </div>

      {data.snapshotError && (
        <div className="notice error">
          <AlertCircle size={18} />
          <span>
            The baseline file at <code>{data.snapshotFile}</code> could not be read ({data.snapshotError}), so there
            is nothing to compare against. It will be rewritten on the next reading.
          </span>
        </div>
      )}

      {!data.liveCountsAvailable && (
        <div className="notice error">
          <AlertCircle size={18} />
          <span>
            Live counts are not available on the <strong>{data.dataSource}</strong> data source. This page reads the
            reporting database, so run the server with <code>DATA_SOURCE=mysql</code> (or <code>hybrid</code>) to see
            the comparison.
          </span>
        </div>
      )}

      {!baseline && !data.snapshotError && data.liveCountsAvailable && (
        <div className="notice info">
          <CheckCircle2 size={18} />
          <span>
            {data.recordedNow
              ? 'This first reading has just been recorded. It becomes the baseline, so the next visit on a later day can show what changed overnight.'
              : 'No baseline has been recorded yet. It is written on the first successful reading.'}
          </span>
        </div>
      )}

      <div className="system-info-meta">
        <div className="system-info-meta-card">
          <p className="eyebrow">Baseline taken</p>
          <strong>{baseline ? stampLabel(baseline.takenAt) : 'Not yet'}</strong>
          <span>{baseline ? `live counts are from today, ${shortDate(data.generatedAt)}` : 'nothing to compare against yet'}</span>
        </div>
        <div className="system-info-meta-card">
          <p className="eyebrow">Rows at baseline</p>
          <strong>{count(readingTotal(baseline))}</strong>
          <span>
            {baseline ? `across ${Object.keys(baseline.counts).length} tables` : 'recorded with the first reading'}
          </span>
        </div>
        <div className="system-info-meta-card">
          <p className="eyebrow">Newest employee change</p>
          <strong>{data.dataAsOf ?? '—'}</strong>
          <span>the data’s own freshness signal</span>
        </div>
        <div className="system-info-meta-card">
          <p className="eyebrow">Snapshot</p>
          <strong className="system-info-meta-script">{data.snapshotFile}</strong>
          <span>
            {data.recordedNow
              ? 'a new reading was recorded just now'
              : `written by the server itself · one reading a day${reloaded ? ` · ${reloaded} reloaded` : ''}`}
          </span>
        </div>
      </div>

      {data.rows.length > 0 && (
        <div className="system-info-table-wrap">
          <table className="system-info-table">
            <thead>
              <tr>
                <th>Table</th>
                <th className="system-info-num">Baseline {shortDate(baseline?.takenAt)}</th>
                <th className="system-info-num">Live {shortDate(data.generatedAt)}</th>
                <th className="system-info-num">Change</th>
                <th className="system-info-num">%</th>
                <th className="system-info-num">Rows</th>
                <th><span className="sr-only">Notes</span></th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => {
                const attention = attentionFor(row, anyMoved);
                const direction = row.delta === null || row.delta === 0 ? '' : row.delta > 0 ? 'up' : 'down';
                return (
                  <tr key={row.table} className={attention ? `system-info-row system-info-row--${attention}` : 'system-info-row'}>
                    <td><span className="system-info-table-name">{row.table}</span></td>
                    <td className="system-info-num">{count(row.baselineCount)}</td>
                    <td className="system-info-num">{count(row.liveCount)}</td>
                    <td className={`system-info-num system-info-delta ${direction ? `system-info-delta--${direction}` : ''}`}>
                      {signed(row.delta)}
                    </td>
                    <td className={`system-info-num system-info-delta ${direction ? `system-info-delta--${direction}` : ''}`}>
                      {signedPct(row.deltaPct)}
                    </td>
                    <td className="system-info-num">
                      {row.contentChanged === null
                        ? <span className="system-info-content">—</span>
                        : (
                          <span
                            className={row.contentChanged ? 'system-info-content system-info-content--changed' : 'system-info-content'}
                            title={row.contentChanged ? 'The rows differ from the baseline even though the count may not.' : 'Identical rows to the baseline.'}
                          >
                            {row.contentChanged ? 'changed' : 'same'}
                          </span>
                        )}
                    </td>
                    <td className="system-info-note">
                      {attention && (
                        <span className="system-info-flag" title={ATTENTION_COPY[attention]}>
                          <TriangleAlert size={13} />
                          <span className="sr-only">{ATTENTION_COPY[attention]}</span>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {flagged.length > 0 && (
        <div className="system-info-legend">
          <h3 className="settings-section-title"><TriangleAlert size={16} />Worth a look</h3>
          <ul>
            {flagged.map((row) => {
              const attention = attentionFor(row, anyMoved)!;
              return (
                <li key={row.table}>
                  <span className="system-info-legend-table">{row.table}</span>
                  <span>{ATTENTION_COPY[attention]}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="system-info-legend">
        <h3 className="settings-section-title"><History size={16} />Reading history</h3>
        {data.readings.length > 1 ? (
          <div className="system-info-table-wrap">
            <table className="system-info-table">
              <thead>
                <tr>
                  <th>Taken</th>
                  <th className="system-info-num">Tables</th>
                  <th className="system-info-num">Rows at reading</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {data.readings.map((reading) => (
                  <tr key={reading.takenAt} className="system-info-row">
                    <td><span className="system-info-table-name">{stampLabel(reading.takenAt)}</span></td>
                    <td className="system-info-num">{Object.keys(reading.counts).length}</td>
                    <td className="system-info-num">{count(readingTotal(reading))}</td>
                    <td>{reading.source || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="settings-hint">
            Only one reading has been recorded so far, so there is nothing to compare it with. One reading is taken
            per day and kept in <code>{data.snapshotFile}</code>, so tomorrow’s reading will have this one to compare
            against.
          </p>
        )}
      </div>

      <div className="system-info-footnote">
        <p>
          <Database size={13} aria-hidden="true" /> Live counts read from <strong>{data.dataSource}</strong>{' '}
          {data.liveCountsAvailable ? 'and were measured just now' : '(live counts unavailable)'}.
        </p>
        <p>
          <HardDrive size={13} aria-hidden="true" /> The reporting database has no per-row load timestamp and no
          history table, so there is nothing to read back. This page compares against the reading the server wrote
          itself, in <code>{data.snapshotFile}</code> — one reading per day, and only on days the page is opened.
        </p>
        <p>
          <CheckCircle2 size={13} aria-hidden="true" /> Each reading also fingerprints every table, so a nightly
          reload that replaces rows without changing the count still shows up as <em>changed</em>.
        </p>
      </div>
    </section>
  );
}
