import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, CheckCircle2, Palette, Plus, Trash2, Type } from 'lucide-react';
import { createStyleTheme, deleteStyleTheme, getStyleThemes } from './api';
import type { LoginSession, StyleTheme, StyleThemeInput } from './types';
import {
  BUILT_IN_STYLES,
  DEFAULT_STYLE,
  MAIN_FONT_OPTIONS,
  MONO_FONT_OPTIONS,
  WCPSS_STYLE,
  applyStyle,
  loadStyleId,
  saveStyleId,
  themeToDefinition,
} from './styleThemes';
import type { StyleDefinition } from './styleThemes';

function errorMessage(failure: unknown, fallback: string): string {
  if (failure instanceof Error) {
    switch (failure.message) {
      case 'FORBIDDEN': return 'Admin access is required.';
      case 'FEATURE_DISABLED': return 'Style Configuration is currently disabled.';
      case 'STYLE_NOT_FOUND': return 'That style no longer exists.';
      case 'STYLE_STORAGE_NOT_READY': return 'Style storage is not set up yet. Ask a DBA to run docs/sql/style-themes.mysql.sql, then try again.';
      case 'INVALID_COLOR': return 'Colors must be valid hex values (e.g. #165788).';
      case 'NAME_REQUIRED': return 'A style name is required.';
      default: return failure.message.startsWith('HTTP_') ? fallback : failure.message;
    }
  }
  return fallback;
}

// A small live preview swatch so the admin sees the palette + fonts before saving.
function StylePreviewCard({ style, selected, onSelect, onDelete }: {
  style: StyleDefinition;
  selected: boolean;
  onSelect: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className={`style-card ${selected ? 'selected' : ''}`} data-style-preview={style.id}>
      <div className="style-card-swatch" style={{ background: style.noBackgroundImage ? style.backgroundColor : `radial-gradient(circle at 75% 8%, ${style.accentColor}22, transparent 8rem), ${style.backgroundColor}`, color: style.textColor, borderRadius: style.radius }}>
        <span className="style-card-swatch-heading" style={{ fontFamily: style.mainFont, color: style.primaryColor }}>Aa</span>
        <span className="style-card-swatch-body" style={{ fontFamily: style.mainFont }}>The quick brown fox</span>
        <span className="style-card-swatch-mono" style={{ fontFamily: style.monoFont, color: style.accentColor }}>0123456789</span>
      </div>
      <div className="style-card-body">
        <div className="style-card-title">
          <strong>{style.name}</strong>
          {style.isDefault && <span className="style-card-tag">Default</span>}
          {style.noBackgroundImage && <span className="style-card-tag style-card-tag--muted">No background image</span>}
          <span className="style-card-tag style-card-tag--muted">{style.radius}px corners</span>
        </div>
        <p className="style-card-desc">{style.description || 'No description.'}</p>
        <div className="style-card-colors">
          <span className="style-card-dot" style={{ background: style.primaryColor }} title={`Primary ${style.primaryColor}`} />
          <span className="style-card-dot" style={{ background: style.accentColor }} title={`Accent ${style.accentColor}`} />
          <span className="style-card-dot" style={{ background: style.backgroundColor, border: '1px solid rgba(0,0,0,.15)' }} title={`Background ${style.backgroundColor}`} />
          <span className="style-card-dot" style={{ background: style.textColor }} title={`Text ${style.textColor}`} />
        </div>
        <div className="style-card-actions">
          <button className={selected ? 'export-button' : 'export-button export-button--secondary'} onClick={onSelect} disabled={selected}>
            {selected ? <><Check size={16} />Applied</> : 'Apply style'}
          </button>
          {onDelete && !style.isDefault && (
            <button className="back-button" onClick={onDelete} title="Delete style"><Trash2 size={15} />Delete</button>
          )}
        </div>
      </div>
    </div>
  );
}

// The add/edit form. Fonts are split into Main and Number/Code pickers, per the
// requirement that staff select them separately.
function StyleForm({ session, onCreated, onCancel }: {
  session: LoginSession;
  onCreated: (theme: StyleTheme) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [mainFont, setMainFont] = useState(MAIN_FONT_OPTIONS[0].stack);
  const [monoFont, setMonoFont] = useState(MONO_FONT_OPTIONS[0].stack);
  const [primaryColor, setPrimaryColor] = useState(DEFAULT_STYLE.primaryColor);
  const [accentColor, setAccentColor] = useState(DEFAULT_STYLE.accentColor);
  const [backgroundColor, setBackgroundColor] = useState(DEFAULT_STYLE.backgroundColor);
  const [textColor, setTextColor] = useState(DEFAULT_STYLE.textColor);
  const [radius, setRadius] = useState(DEFAULT_STYLE.radius);
  const [noBackgroundImage, setNoBackgroundImage] = useState(DEFAULT_STYLE.noBackgroundImage);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function prefillFrom(style: StyleDefinition) {
    setName(style.id === 'default' ? '' : `${style.name} (copy)`);
    setDescription(style.description);
    setMainFont(style.mainFont);
    setMonoFont(style.monoFont);
    setPrimaryColor(style.primaryColor);
    setAccentColor(style.accentColor);
    setBackgroundColor(style.backgroundColor);
    setTextColor(style.textColor);
    setRadius(style.radius);
    setNoBackgroundImage(style.noBackgroundImage);
  }

  async function save() {
    setError('');
    setSaving(true);
    try {
      const input: StyleThemeInput = {
        name: name.trim(),
        description: description.trim() || null,
        mainFont,
        monoFont,
        primaryColor,
        accentColor,
        backgroundColor,
        textColor,
        radius,
        noBackgroundImage
      };
      const created = await createStyleTheme(session, input);
      onCreated(created);
    } catch (failure) {
      setError(errorMessage(failure, 'The style could not be saved.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="style-form">
      <div className="style-form-head">
        <h3><Plus size={16} />New style</h3>
        <p className="settings-section-desc">Create a style staff can apply. Pick the main font and the number/code font separately.</p>
      </div>

      {error && <div className="notice error"><AlertCircle size={18} /><span>{error}</span></div>}

      <div className="style-form-row">
        <label className="settings-field"><span>Style name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Wake County Public Schools" maxLength={128} />
        </label>
        <label className="settings-field"><span>Description (optional)</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Short note shown on the style card" maxLength={255} />
        </label>
      </div>

      <div className="style-form-row">
        <label className="settings-field"><span><Type size={13} /> Main font</span>
          <select value={mainFont} onChange={(e) => setMainFont(e.target.value)}>
            {MAIN_FONT_OPTIONS.map((option) => <option key={option.id} value={option.stack}>{option.label}</option>)}
          </select>
        </label>
        <label className="settings-field"><span><Type size={13} /> Number / code font</span>
          <select value={monoFont} onChange={(e) => setMonoFont(e.target.value)}>
            {MONO_FONT_OPTIONS.map((option) => <option key={option.id} value={option.stack}>{option.label}</option>)}
          </select>
        </label>
      </div>

      <div className="style-form-row style-form-colors">
        <label className="settings-field"><span>Primary color</span>
          <span className="style-color-input"><input type="color" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} /><input value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} /></span>
        </label>
        <label className="settings-field"><span>Accent color</span>
          <span className="style-color-input"><input type="color" value={accentColor} onChange={(e) => setAccentColor(e.target.value)} /><input value={accentColor} onChange={(e) => setAccentColor(e.target.value)} /></span>
        </label>
        <label className="settings-field"><span>Background</span>
          <span className="style-color-input"><input type="color" value={backgroundColor} onChange={(e) => setBackgroundColor(e.target.value)} /><input value={backgroundColor} onChange={(e) => setBackgroundColor(e.target.value)} /></span>
        </label>
        <label className="settings-field"><span>Text color</span>
          <span className="style-color-input"><input type="color" value={textColor} onChange={(e) => setTextColor(e.target.value)} /><input value={textColor} onChange={(e) => setTextColor(e.target.value)} /></span>
        </label>
        <label className="settings-field"><span>Corner radius (px)</span>
          <span className="style-radius-input">
            <input type="range" min={0} max={20} step={1} value={radius} onChange={(e) => setRadius(Number(e.target.value))} aria-label="Corner radius in pixels" />
            <input type="number" min={0} max={40} value={radius} onChange={(e) => setRadius(Math.max(0, Math.min(40, Number(e.target.value) || 0)))} aria-label="Corner radius value" />
          </span>
        </label>
      </div>

      {/* Background image toggle: off = the decorative gradient; on = a flat, clear background. */}
      <label className="toggle-row style-form-toggle">
        <span className="toggle-row-label">
          No background image
          <span className="toggle-row-hint">Removes the decorative gradient so the background is a flat, clear color (e.g. pure white).</span>
        </span>
        <span className="toggle-label">{noBackgroundImage ? 'On' : 'Off'}</span>
        <button
          type="button"
          role="switch"
          aria-checked={noBackgroundImage}
          className={noBackgroundImage ? 'switch switch-on' : 'switch'}
          onClick={() => setNoBackgroundImage((value) => !value)}
        >
          <span className="switch-knob" />
        </button>
      </label>

      <div className="style-form-actions">
        <button className="export-button" onClick={() => void save()} disabled={saving || !name.trim()}>{saving ? 'Saving...' : 'Save style'}</button>
        <button className="back-button" onClick={onCancel}>Cancel</button>
        <span className="style-form-prefill">
          Start from:
          <button type="button" className="link-button" onClick={() => prefillFrom(DEFAULT_STYLE)}>Default</button>
          <button type="button" className="link-button" onClick={() => prefillFrom(WCPSS_STYLE)}>WCPSS</button>
        </span>
      </div>
    </div>
  );
}

export function StyleConfigurationPage({ session }: { session: LoginSession }) {
  const [themes, setThemes] = useState<StyleTheme[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [selectedId, setSelectedId] = useState<string>(() => loadStyleId(session.user.id));

  const isAdmin = session.user.roles.includes('hr_admin');

  // All selectable styles = built-ins + server themes.
  const styles = useMemo<StyleDefinition[]>(
    () => [...BUILT_IN_STYLES, ...themes.map(themeToDefinition)],
    [themes]
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getStyleThemes(session)
      .then((list) => { if (!cancelled) setThemes(list); })
      .catch((failure) => { if (!cancelled) setError(errorMessage(failure, 'The styles could not be loaded.')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.user.id]);

  function applyStyleById(id: string) {
    const style = styles.find((candidate) => candidate.id === id) ?? DEFAULT_STYLE;
    setSelectedId(style.id);
    saveStyleId(session.user.id, style.id);
    applyStyle(style);
    setNotice(`Applied “${style.name}”.`);
  }

  async function removeStyle(theme: StyleTheme) {
    if (!window.confirm(`Delete the “${theme.name}” style? This cannot be undone.`)) return;
    setError('');
    setNotice('');
    try {
      await deleteStyleTheme(session, theme.id);
      setThemes((current) => current.filter((item) => item.id !== theme.id));
      if (selectedId === theme.id) applyStyleById('default');
      setNotice(`Deleted “${theme.name}”.`);
    } catch (failure) {
      setError(errorMessage(failure, 'The style could not be deleted.'));
    }
  }

  return (
    <section className="reports-page" aria-labelledby="style-title">
      <div className="reports-page-heading">
        <div>
          <p className="eyebrow">Admin</p>
          <h2 id="style-title">Style configuration.</h2>
          <p className="reports-intro">Choose the look of the workspace. The default style is the original; add new styles based on a site or brand. Staff pick the main font and the number/code font separately.</p>
        </div>
        <div className="report-count"><Palette size={16} /><strong>{styles.length}</strong><span>styles</span></div>
      </div>

      {notice && <div className="notice success"><CheckCircle2 size={18} /><span>{notice}</span></div>}
      {error && <div className="notice error"><AlertCircle size={18} /><span>{error}</span></div>}

      {isAdmin && (
        showForm
          ? <StyleForm
              session={session}
              onCreated={(theme) => {
                setThemes((current) => [...current, theme]);
                setShowForm(false);
                setNotice(`Created “${theme.name}”.`);
              }}
              onCancel={() => setShowForm(false)}
            />
          : <div className="style-toolbar">
              <button className="export-button" onClick={() => setShowForm(true)}><Plus size={17} />Add style</button>
              <span className="settings-hint">Styles are shared with everyone; each staff member chooses which one to apply.</span>
            </div>
      )}

      {loading
        ? <div className="empty-state"><span className="loader" />Loading styles</div>
        : <div className="style-grid">
            {styles.map((style) => (
              <StylePreviewCard
                key={style.id}
                style={style}
                selected={selectedId === style.id}
                onSelect={() => applyStyleById(style.id)}
                onDelete={isAdmin && !style.isDefault && !BUILT_IN_STYLES.some((b) => b.id === style.id)
                  ? () => {
                      const theme = themes.find((item) => item.id === style.id);
                      if (theme) void removeStyle(theme);
                    }
                  : undefined}
              />
            ))}
          </div>}
    </section>
  );
}
