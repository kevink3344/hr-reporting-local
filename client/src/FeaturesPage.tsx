import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, ChevronRight, Flag, Gauge, HardDrive, MessageSquare, Palette, SearchCheck, Send } from 'lucide-react';
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
//
// `onManageSystemMessages` opens the System-wide messages page. That page is
// deliberately NOT in the navigation: this page is the only way in, which is why
// the flag row is accompanied by an explicit "Manage messages" link.
//
// `onManageSystemInfo` does the same for the System Information page, which is
// also absent from the navigation because it is an admin-only beta diagnostic.
//
// `onManageStyleConfig` likewise opens Style Configuration, which is no longer a
// navigation item either -- the switch and the link below are the only way in.
export function FeaturesPage({ session, onFlagsChanged, onManageSystemMessages, onManageSystemInfo, onManageStyleConfig }: { session: LoginSession; onFlagsChanged?: (flags: Partial<FeatureFlagsResponse>) => void; onManageSystemMessages?: () => void; onManageSystemInfo?: () => void; onManageStyleConfig?: () => void }) {
  const [futureEnabled, setFutureEnabled] = useState(false);
  const [autoLookupEnabled, setAutoLookupEnabled] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [styleConfigEnabled, setStyleConfigEnabled] = useState(false);
  // Defaults ON: the dashboard is already live, so the switch starts where the
  // server's opt-out default says it should. See GET /api/feature-flags.
  const [kpiEnabled, setKpiEnabled] = useState(true);
  // Defaults ON for the same reason: the message manager is already in use.
  const [systemMessagesEnabled, setSystemMessagesEnabled] = useState(true);
  // Defaults OFF: System Information is a beta diagnostic, so it ships hidden
  // and only an explicit "on" turns it on. See GET /api/feature-flags.
  const [systemInfoEnabled, setSystemInfoEnabled] = useState(false);
  // Defaults OFF: Advanced Search is a new read surface, so it ships hidden
  // behind an opt-in flag. See GET /api/feature-flags.
  const [advancedSearchEnabled, setAdvancedSearchEnabled] = useState(false);
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
        setSystemMessagesEnabled(flags.system_messages);
        setSystemInfoEnabled(flags.system_info);
        setAdvancedSearchEnabled(flags.advanced_search);
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
          <p className="settings-section-desc">When enabled, admins can add CSS styles — including separate main and number/code fonts — and staff can apply the style they prefer. Like System-wide messages, this one has <strong>no navigation link</strong> — open it from the button below.</p>
          <FeatureRow
            enabled={styleConfigEnabled}
            saving={saving}
            title="Enable Style Configuration"
            description="Add and apply CSS styles across the workspace."
            onToggle={(next) => void toggle('style_configuration', next, setStyleConfigEnabled, 'Style Configuration')}
          />
          {onManageStyleConfig && (
            <button type="button" className="feature-link" disabled={!styleConfigEnabled} onClick={onManageStyleConfig}>
              <span className="feature-link-label">Manage styles</span>
              <ChevronRight size={17} />
            </button>
          )}
          {!styleConfigEnabled && <p className="settings-hint">Turn on Style Configuration to manage styles.</p>}
        </div>

        <div className="feature-group">
          <h3 className="settings-section-title"><Send size={16} />System-wide messages</h3>
          <p className="settings-section-desc">When enabled, admins can publish announcements to everyone: a <strong>Banner</strong> renders as a full-width strip directly beneath the header on every page until each person dismisses it, and a <strong>Splash</strong> takes over the screen once, right after sign-in. Unlike the other features, this one has <strong>no navigation link</strong> — open the manager from the button below.</p>
          <FeatureRow
            enabled={systemMessagesEnabled}
            saving={saving}
            title="Enable System-wide messages"
            description="Publish Banner and Splash announcements to everyone."
            onToggle={(next) => void toggle('system_messages', next, setSystemMessagesEnabled, 'System-wide messages')}
          />
          {onManageSystemMessages && (
            <button type="button" className="feature-link" disabled={!systemMessagesEnabled} onClick={onManageSystemMessages}>
              <span className="feature-link-label">Manage messages</span>
              <ChevronRight size={17} />
            </button>
          )}
          {!systemMessagesEnabled && <p className="settings-hint">Turn on System-wide messages to manage them.</p>}
        </div>

        <div className="feature-group">
          <h3 className="settings-section-title"><HardDrive size={16} />System Information (Beta)</h3>
          <p className="settings-section-desc">When enabled, an admin-only <strong>System Information</strong> page shows what changed in the nightly data load. The reporting database keeps no history — no load timestamp, no audit table, no counter to diff — so the server keeps its own baseline in a small JSON file: one reading a day, compared with the live row counts. It also fingerprints every table, so a reload that replaces rows without changing the count still shows up. Like System-wide messages, this one has <strong>no navigation link</strong> — open it from the button below.</p>
          <FeatureRow
            enabled={systemInfoEnabled}
            saving={saving}
            title="Enable System Information"
            description="Show the admin data-load diagnostics page."
            onToggle={(next) => void toggle('system_info', next, setSystemInfoEnabled, 'System Information')}
          />
          {onManageSystemInfo && (
            <button type="button" className="feature-link" disabled={!systemInfoEnabled} onClick={onManageSystemInfo}>
              <span className="feature-link-label">View system information</span>
              <ChevronRight size={17} />
            </button>
          )}
          {!systemInfoEnabled && <p className="settings-hint">Turn on System Information to view it.</p>}
        </div>

        <div className="feature-group">
          <h3 className="settings-section-title"><SearchCheck size={16} />Advanced Search</h3>
          <p className="settings-section-desc">When enabled, an <strong>Advanced Search</strong> page appears in the navigation. It searches the positions you can see by position name, vacancy, contract type, contract code and contract dates, and every result opens the position or the person record behind it.</p>
          <FeatureRow
            enabled={advancedSearchEnabled}
            saving={saving}
            title="Enable Advanced Search"
            description="Search positions by name, vacancy, contract type, code and dates."
            onToggle={(next) => void toggle('advanced_search', next, setAdvancedSearchEnabled, 'Advanced Search')}
          />
        </div>
      </div>
    </section>
  );
}
