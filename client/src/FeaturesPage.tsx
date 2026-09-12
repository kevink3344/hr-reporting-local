import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Flag, Gauge, MessageSquare, Palette } from 'lucide-react';
import { getFeatureFlag, setFeatureFlag } from './api';
import { isFeatureFlagKey } from './types';
import type { FeatureFlagsResponse, LoginSession } from './types';

function errorMessage(failure: unknown, fallback: string): string {
  if (failure instanceof Error) {
    switch (failure.message) {
      case 'FORBIDDEN': return 'Admin access is required.';
      default: return failure.message.startsWith('HTTP_') ? fallback : failure.message;
    }
  }
  return fallback;
}

// A single feature row. The toggle switch comes FIRST so every switch in the
// list is left-aligned and lines up in a column; the title + description
// sentence follows to its right.
function FeatureRow({
  enabled,
  disabled = false,
  nested = false,
  saving,
  title,
  description,
  onToggle
}: {
  enabled: boolean;
  disabled?: boolean;
  nested?: boolean;
  saving: boolean;
  title: string;
  description: React.ReactNode;
  onToggle: (next: boolean) => void;
}) {
  const classes = ['feature-row'];
  if (nested) classes.push('feature-row--nested');
  if (disabled) classes.push('feature-row--disabled');
  return (
    <div className={classes.join(' ')}>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-disabled={disabled}
        aria-label={title}
        className={enabled ? 'switch switch-on' : 'switch'}
        disabled={saving || disabled}
        onClick={() => onToggle(!enabled)}
      >
        <span className="switch-knob" />
      </button>
      <div className="feature-row-copy">
        <span className="feature-row-title">
          {title}
          <span className={enabled ? 'feature-row-state feature-row-state--on' : 'feature-row-state'}>
            {enabled ? 'On' : 'Off'}
          </span>
        </span>
        <p className="feature-row-desc">{description}</p>
      </div>
    </div>
  );
}

// Admin-only Feature Flags page. Extracted from the Report Configuration tabs so
// the list can grow without crowding the report settings.
//
// `onFlagsChanged` hands every successful toggle to the app shell. Every flag
// here gates something the shell has already rendered — a nav item, a whole
// view, or a panel inside a position — so without this the switch would appear
// to do nothing until the next page load.
export function FeaturesPage({ session, onFlagsChanged }: { session: LoginSession; onFlagsChanged?: (flags: Partial<FeatureFlagsResponse>) => void }) {
  const [futureEnabled, setFutureEnabled] = useState(false);
  const [autoLookupEnabled, setAutoLookupEnabled] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [styleConfigEnabled, setStyleConfigEnabled] = useState(false);
  // Defaults ON: the dashboard is already live, so the switch starts where the
  // server's opt-out default says it should. See GET /api/feature-flags.
  const [kpiEnabled, setKpiEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    getFeatureFlag(session)
      .then((flags) => {
        setFutureEnabled(flags.future_positions);
        setAutoLookupEnabled(flags.employee_auto_lookup);
        setAiEnabled(flags.ai_assistant);
        setStyleConfigEnabled(flags.style_configuration);
        setKpiEnabled(flags.kpi_dashboard);
      })
      .catch(() => setError('The feature flags could not be loaded.'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.user.id]);

  async function toggle(key: string, next: boolean, setState: (value: boolean) => void, label: string) {
    setNotice('');
    setError('');
    setSaving(true);
    try {
      const flag = await setFeatureFlag(session, key, next);
      setState(flag.enabled);
      // Tell the shell about the flag so anything it already rendered keeps up.
      if (isFeatureFlagKey(key)) {
        const patch: Partial<FeatureFlagsResponse> = {};
        patch[key] = flag.enabled;
        onFlagsChanged?.(patch);
      }
      setNotice(`${label} is now ${flag.enabled ? 'enabled' : 'disabled'}.`);
    } catch (failure) {
      setError(errorMessage(failure, 'The feature flag could not be updated.'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <section className="reports-page"><div className="empty-state"><span className="loader" />Loading features</div></section>;

  return (
    <section className="reports-page" aria-labelledby="features-title">
      <div className="reports-page-heading">
        <div>
          <p className="eyebrow">Admin</p>
          <h2 id="features-title">Features.</h2>
          <p className="reports-intro">Turn optional features on or off for everyone. Your own session picks a change up straight away; everyone else sees it the next time the app loads.</p>
        </div>
      </div>

      {notice && <div className="notice success"><CheckCircle2 size={18} /><span>{notice}</span></div>}
      {error && <div className="notice error"><AlertCircle size={18} /><span>{error}</span></div>}

      <div className="feature-list">
        <div className="feature-group">
          <h3 className="settings-section-title"><Gauge size={16} />KPI Dashboard</h3>
          <p className="settings-section-desc">When enabled, a <strong>KPI Dashboard</strong> page appears in the navigation. Every tile and bar on it is clickable, opening the exact list behind the number along with its definition and read-only SQL. When disabled, the menu link is removed.</p>
          <FeatureRow
            enabled={kpiEnabled}
            saving={saving}
            title="Enable KPI Dashboard"
            description="Show the KPI Dashboard link in the navigation."
            onToggle={(next) => void toggle('kpi_dashboard', next, setKpiEnabled, 'KPI Dashboard')}
          />
        </div>

        <div className="feature-group">
          <h3 className="settings-section-title"><Flag size={16} />Future Positions (Beta)</h3>
          <p className="settings-section-desc">When enabled, staff can stage a new incumbent directly from a position's detail page. The record stays <strong>pending</strong> until it is sent for review, then the data team reviews it and marks it <strong>completed</strong>.</p>
          <FeatureRow
            enabled={futureEnabled}
            saving={saving}
            title="Enable Future Positions"
            description="Stage a new incumbent from a position's detail page."
            onToggle={(next) => void toggle('future_positions', next, setFutureEnabled, 'Future Positions')}
          />
          {/* Nested sub-feature: only meaningful when Future Positions is on. */}
          <FeatureRow
            nested
            disabled={!futureEnabled}
            enabled={autoLookupEnabled}
            saving={saving}
            title="Enable Auto-Lookup"
            description="Fills the incumbent name and account number automatically once a 6-digit employee number is entered."
            onToggle={(next) => void toggle('employee_auto_lookup', next, setAutoLookupEnabled, 'Employee auto-lookup')}
          />
          {!futureEnabled && <p className="settings-hint">Turn on Future Positions to configure auto-lookup.</p>}
        </div>

        <div className="feature-group">
          <h3 className="settings-section-title"><MessageSquare size={16} />AI Assistant (Development Only)</h3>
          <p className="settings-section-desc">When enabled, a natural-language assistant can answer questions about the data — for example <em>“Which schools have the most open positions?”</em> It generates read-only, school-scoped SQL behind the scenes and shows a history of recent searches.</p>
          <FeatureRow
            enabled={aiEnabled}
            saving={saving}
            title="Enable AI Assistant"
            description="Ask questions about the data in plain language."
            onToggle={(next) => void toggle('ai_assistant', next, setAiEnabled, 'AI Assistant')}
          />
        </div>

        <div className="feature-group">
          <h3 className="settings-section-title"><Palette size={16} />Style Configuration</h3>
          <p className="settings-section-desc">When enabled, a <strong>Style Configuration</strong> page appears in the navigation. Admins can add CSS styles — including separate main and number/code fonts — and staff can apply the style they prefer.</p>
          <FeatureRow
            enabled={styleConfigEnabled}
            saving={saving}
            title="Enable Style Configuration"
            description="Add and apply CSS styles across the workspace."
            onToggle={(next) => void toggle('style_configuration', next, setStyleConfigEnabled, 'Style Configuration')}
          />
        </div>
      </div>
    </section>
  );
}
