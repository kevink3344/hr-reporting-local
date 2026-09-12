import { ChevronRight } from 'lucide-react';
import type { KpiBar } from './types';

type KpiBarListProps = {
  bars: KpiBar[];
  /** Number of seats the largest bar stands for — the 100% reference. */
  max: number;
  accent?: boolean;
  onPick: (bar: KpiBar) => void;
};

/**
 * Horizontal bar list. Every row is a `<button>`: clicking a bar drills into
 * that Position Title.
 *
 * The fill is `display:block` (see `.kpi-bar-fill` in styles.css). An inline
 * fill with only a percentage width collapses to 0×0 and every bar renders as
 * an empty track — a bug that looks exactly like "no data".
 */
export function KpiBarList({ bars, max, accent = false, onPick }: KpiBarListProps) {
  return (
    <div className="kpi-bars">
      {bars.map((bar) => {
        const width = max > 0 ? Math.max(2, Math.round((bar.value / max) * 100)) : 0;
        return (
          <button key={bar.posName} type="button" className="kpi-bar-row" onClick={() => onPick(bar)} aria-label={`${bar.label}: ${bar.value}. View these positions.`}>
            <span className="kpi-bar-name">
              {bar.label}
              <ChevronRight size={13} className="kpi-bar-go" aria-hidden />
            </span>
            <span className="kpi-bar-track">
              <span className={accent ? 'kpi-bar-fill accent' : 'kpi-bar-fill'} style={{ width: `${width}%` }} />
            </span>
            <span className="kpi-bar-count">{bar.value}</span>
          </button>
        );
      })}
    </div>
  );
}
