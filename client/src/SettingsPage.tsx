import { Fragment, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Archive, CheckCircle2, FileText, Flag, GripVertical, ListChecks, Pencil, Play, Plus, Settings2, Trash2, X } from 'lucide-react';
import { createReport, createReportSection, getReports, getReportSections, runReport, updateReport, updateReportSection, validateReportSql, getFeatureFlag, setFeatureFlag } from './api';
import type { GenericReportRowWithSubreport, GenericSubreportRun, HighlightColorId, HighlightLogic, HighlightOperator, LoginSession, ReportDefinition, ReportHighlightRule, ReportHighlightCondition, ReportSection, School } from './types';
import { describeHighlightRule, HIGHLIGHT_PALETTE, ruleMatchesRow } from './types';

type Tab = 'sections' | 'reports' | 'features';

function errorMessage(failure: unknown, fallback: string): string {
  if (failure instanceof Error) {
    switch (failure.message) {
      case 'FORBIDDEN': return 'Admin access is required.';
      case 'TITLE_REQUIRED': return 'A title is required.';
      case 'SECTION_TITLE_CONFLICT': return 'A section with that title already exists.';
      case 'REPORT_TITLE_CONFLICT': return 'A report with that title already exists in this section.';
      case 'SECTION_NOT_FOUND': return 'The selected section no longer exists.';
      case 'SECTION_HAS_REPORTS': return 'This section still has reports. Move or archive them first.';
      case 'REPORT_NOT_FOUND': return 'The report no longer exists.';
      case 'SQL_REQUIRED': return 'A SQL query is required.';
      case 'SQL_QUERY_TOO_LONG': return 'The SQL query is too long.';
      case 'ONLY_SELECT_ALLOWED': return 'Only a single SELECT or WITH query is allowed.';
      case 'MULTI_STATEMENT_NOT_ALLOWED': return 'Multiple statements are not allowed.';
      case 'FORBIDDEN_KEYWORD': return 'The query uses a forbidden keyword (e.g. INSERT, UPDATE, DELETE, DROP).';
      case 'ORGANIZATION_SCOPE_REQUIRED': return 'The query must reference the :organization bind parameter.';
      case 'SUBREPORT_SCOPE_REQUIRED': return 'The subreport query must reference the :person_id bind parameter.';
      default: return failure.message.startsWith('HTTP_') ? fallback : failure.message;
    }
  }
  return fallback;
}

function SectionsTab({ session, sections, refresh }: { session: LoginSession; sections: ReportSection[]; refresh: () => Promise<void> }) {
  const [title, setTitle] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');

  async function addSection() {
    setNotice('');
    setError('');
    try {
      await createReportSection(session, { title: title.trim(), sortOrder: sections.length + 1 });
      setTitle('');
      setNotice('Section added.');
      await refresh();
    } catch (failure) {
      setError(errorMessage(failure, 'The section could not be added.'));
    }
  }

  async function saveRename(id: string) {
    setNotice('');
    setError('');
    try {
      await updateReportSection(session, id, { title: editingTitle.trim() });
      setEditingId(null);
      setNotice('Section renamed.');
      await refresh();
    } catch (failure) {
      setError(errorMessage(failure, 'The section could not be renamed.'));
    }
  }

  async function archiveSection(id: string) {
    if (!window.confirm('Archive this section? It will be hidden from the catalog. Move or archive its reports first.')) return;
    setNotice('');
    setError('');
    try {
      await updateReportSection(session, id, { isActive: false });
      setNotice('Section archived.');
      await refresh();
    } catch (failure) {
      setError(errorMessage(failure, 'The section could not be archived.'));
    }
  }

  return <div className="settings-panel">
    {notice && <div className="notice success"><CheckCircle2 size={18} /><span>{notice}</span></div>}
    {error && <div className="notice error"><AlertCircle size={18} /><span>{error}</span></div>}
    <div className="settings-form-row">
      <label className="settings-field"><span>New section title</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Attendance" /></label>
      <button className="export-button" onClick={() => void addSection()} disabled={!title.trim()}><Plus size={17} />Add section</button>
    </div>
    <div className="settings-table-wrap">
      <table className="report-table sections-table">
        <thead><tr><th>Title</th><th>Reports</th><th>Order</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>{sections.map((section) => <tr key={section.id} className="report-card">
          <td data-label="Title">{editingId === section.id
            ? <input value={editingTitle} onChange={(event) => setEditingTitle(event.target.value)} />
            : <span>{section.title}</span>}</td>
          <td data-label="Reports"><span>{section.reportCount ?? 0}</span></td>
          <td data-label="Order"><span>{section.sortOrder}</span></td>
          <td data-label="Status"><span>{section.isActive ? 'Active' : 'Inactive'}</span></td>
          <td data-label="Actions"><span className="settings-actions">
            {editingId === section.id
              ? <><button className="back-button" onClick={() => void saveRename(section.id)}>Save</button><button className="back-button" onClick={() => setEditingId(null)}>Cancel</button></>
              : <button className="back-button" onClick={() => { setEditingId(section.id); setEditingTitle(section.title); }}><Pencil size={15} />Rename</button>}
            <button className="back-button" onClick={() => void archiveSection(section.id)}><Archive size={15} />Archive</button>
          </span></td>
        </tr>)}</tbody>
      </table>
    </div>
  </div>;
}

const HIGHLIGHT_OPERATORS: { value: HighlightOperator; label: string }[] = [
  { value: 'eq', label: 'equals' },
  { value: 'neq', label: 'not equals' },
  { value: 'contains', label: 'contains' },
  { value: 'not_contains', label: 'does not contain' },
  { value: 'is_empty', label: 'is empty' },
  { value: 'is_not_empty', label: 'is not empty' },
];

function ColumnSelect({ value, onChange, columns }: { value: string; onChange: (v: string) => void; columns: string[] }) {
  if (columns.length > 0) {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Column">
        {columns.map((c) => <option key={c} value={c}>{c}</option>)}
        {!columns.includes(value) && value ? <option value={value}>{value} (custom)</option> : null}
      </select>
    );
  }
  return <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="Column" aria-label="Column" />;
}

function ConditionRows({ conditions, onChange, columns }: {
  conditions: ReportHighlightCondition[];
  onChange: (next: ReportHighlightCondition[]) => void;
  columns: string[];
}) {
  function updateCondition(i: number, patch: Partial<ReportHighlightCondition>) {
    const next = conditions.slice();
    next[i] = { ...next[i], ...patch } as ReportHighlightCondition;
    // Clear value when switching to is_empty / is_not_empty
    if (patch.operator === 'is_empty' || patch.operator === 'is_not_empty') next[i].value = '';
    onChange(next);
  }

  function addCondition() {
    onChange([...conditions, { column: columns[0] ?? '', operator: 'eq' as HighlightOperator, value: '' }]);
  }

  function removeCondition(i: number) {
    onChange(conditions.filter((_, idx) => idx !== i));
  }

  return <div className="highlight-conditions">
    {conditions.map((cond, i) => {
      const needsValue = cond.operator !== 'is_empty' && cond.operator !== 'is_not_empty';
      return <div className="highlight-condition" key={i}>
        <span className="highlight-cond-badge">{i === 0 ? 'WHEN' : 'AND/OR'}</span>
        <ColumnSelect value={cond.column} onChange={(v) => updateCondition(i, { column: v })} columns={columns} />
        <select value={cond.operator} onChange={(e) => updateCondition(i, { operator: e.target.value as HighlightOperator })} aria-label="Operator">
          {HIGHLIGHT_OPERATORS.map((op) => <option key={op.value} value={op.value}>{op.label}</option>)}
        </select>
        {needsValue && <input value={cond.value} onChange={(e) => updateCondition(i, { value: e.target.value })} placeholder="Value" aria-label="Value" />}
        <button className="icon-button subtle highlight-delete" onClick={() => removeCondition(i)} aria-label="Remove condition"><X size={14} /></button>
      </div>;
    })}
    {conditions.length < 5 && (
      <button type="button" className="back-button highlight-add-cond" onClick={addCondition}><Plus size={14} />Add condition</button>
    )}
  </div>;
}

function RowHighlightingEditor({
  rules,
  onChange,
  columns,
}: {
  rules: ReportHighlightRule[];
  onChange: (next: ReportHighlightRule[]) => void;
  columns: string[];
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  function addRule() {
    if (rules.length >= 10) return;
    const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    onChange([...rules, { id, logic: 'or', conditions: [{ column: columns[0] ?? '', operator: 'eq' as HighlightOperator, value: '' }], color: 'pastel_red' as HighlightColorId }]);
  }

  function updateRule(index: number, patch: Partial<ReportHighlightRule>) {
    const next = rules.slice();
    next[index] = { ...next[index], ...patch } as ReportHighlightRule;
    onChange(next);
  }

  function removeRule(index: number) {
    onChange(rules.filter((_, i) => i !== index));
  }

  function moveRule(from: number, to: number) {
    if (to < 0 || to >= rules.length) return;
    const next = rules.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  }

  function onDragStart(index: number) { setDragIndex(index); }
  function onDragOver(e: React.DragEvent, index: number) {
    e.preventDefault();
    if (dragIndex === null || dragIndex === index) return;
  }
  function onDrop(e: React.DragEvent, index: number) {
    e.preventDefault();
    if (dragIndex === null || dragIndex === index) return;
    moveRule(dragIndex, index);
    setDragIndex(null);
  }

  if (rules.length === 0) {
    return <div className="highlight-empty">
      <p>No highlighting rules. Rows will render without tint.</p>
      <button className="back-button" onClick={addRule}><Plus size={15} />Add rule</button>
    </div>;
  }

  return <div className="highlight-rules">
    {rules.map((rule, index) => {
      const palette = HIGHLIGHT_PALETTE[rule.color];
      return <div
        key={rule.id}
        className={`highlight-rule ${dragIndex === index ? 'dragging' : ''}`}
        draggable
        onDragStart={() => onDragStart(index)}
        onDragOver={(e) => onDragOver(e, index)}
        onDrop={(e) => onDrop(e, index)}
        onDragEnd={() => setDragIndex(null)}
      >
        <div className="highlight-rule-head">
          <span className="highlight-drag" title="Drag to reorder" aria-hidden="true"><GripVertical size={14} /></span>
          <span className="highlight-when">Rule {index + 1}</span>
          <span className="highlight-rule-meta">{describeHighlightRule(rule)}</span>
          <span className="highlight-spacer" />
          <label className="highlight-logic" title="Combine conditions">
            <span className="highlight-logic-label">Match</span>
            <select value={rule.logic} onChange={(e) => updateRule(index, { logic: e.target.value as HighlightLogic })} aria-label="Logic">
              <option value="or">any (OR)</option>
              <option value="and">all (AND)</option>
            </select>
          </label>
          <label className="highlight-color" title={palette.label}>
            <span className="highlight-color-dot" style={{ background: palette.bg, borderColor: palette.border }} aria-hidden="true" />
            <select value={rule.color} onChange={(e) => updateRule(index, { color: e.target.value as HighlightColorId })} aria-label="Color">
              {(Object.keys(HIGHLIGHT_PALETTE) as HighlightColorId[]).map((cid) => <option key={cid} value={cid}>{HIGHLIGHT_PALETTE[cid].label}</option>)}
            </select>
          </label>
          <button className="icon-button subtle highlight-delete" onClick={() => removeRule(index)} aria-label="Delete rule"><Trash2 size={14} /></button>
          <span className="highlight-move">
            <button className="icon-button subtle" onClick={() => moveRule(index, index - 1)} disabled={index === 0} aria-label="Move up">↑</button>
            <button className="icon-button subtle" onClick={() => moveRule(index, index + 1)} disabled={index === rules.length - 1} aria-label="Move down">↓</button>
          </span>
        </div>
        <ConditionRows
          key={`${rule.id}-cond`}
          conditions={rule.conditions ?? []}
          onChange={(nextConds) => updateRule(index, { conditions: nextConds })}
          columns={columns}
        />
      </div>;
    })}
    <div className="highlight-actions">
      <button className="back-button" onClick={addRule} disabled={rules.length >= 10}><Plus size={15} />Add rule</button>
      <span className="highlight-hint">First matching rule wins. Drag ⋮⋮ to reorder priority. Max 10 rules, max 5 conditions each.</span>
    </div>
  </div>;
}

function SubreportPreviewCells({ sub, colSpan }: { sub?: GenericSubreportRun | null; colSpan: number }) {
  if (!sub || sub.rows.length === 0) return null;
  return (
    <tr className="report-subreport-row">
      <td colSpan={colSpan}>
        <table className="report-subreport-table">
          <thead>
            <tr>{sub.columns.map((col) => (<th key={col}>{col}</th>))}</tr>
          </thead>
          <tbody>
            {sub.rows.map((childRow, childIndex) => (
              <tr key={childIndex}>
                {sub.columns.map((col) => (
                  <td key={col} data-label={col}>
                    {childRow[col] === null || childRow[col] === undefined ? '' : String(childRow[col])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </td>
    </tr>
  );
}

function ReportsTab({ session, schools, sections, reports, refresh }: { session: LoginSession; schools: School[]; sections: ReportSection[]; reports: ReportDefinition[]; refresh: () => Promise<void> }) {
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState<Partial<ReportDefinition> & { id?: string } | null>(null);
  const [editorTab, setEditorTab] = useState<'general' | 'rules' | 'options'>('general');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [validateState, setValidateState] = useState<'idle' | 'ok' | 'fail'>('idle');
  const [previewOrg, setPreviewOrg] = useState(schools[0]?.name ?? '');
  const [preview, setPreview] = useState<{ columns: string[]; rows: GenericReportRowWithSubreport[]; subreport?: { keyColumn: string } | null } | null>(null);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return reports;
    return reports.filter((report) => `${report.title} ${report.description} ${report.sectionTitle ?? ''}`.toLowerCase().includes(needle));
  }, [reports, filter]);

  function parseColumnList(value: string): string[] {
    return value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean);
  }

  function startNew() {
    setEditing({ sectionId: sections[0]?.id ?? '', title: '', description: '', sqlQuery: 'SELECT 1 AS example WHERE :organization = :organization', status: 'inactive', highlightRules: [], subreportQuery: '', subreportKeyColumn: 'person_id', columns: [], additionalColumns: [] });
    setEditorTab('general');
    setValidateState('idle');
    setPreview(null);
    setError('');
    setNotice('');
  }

  function startEdit(report: ReportDefinition) {
    setEditing({ ...report, highlightRules: report.highlightRules ?? [], subreportQuery: report.subreportQuery ?? '', subreportKeyColumn: report.subreportKeyColumn ?? 'person_id', columns: report.columns ?? [], additionalColumns: report.additionalColumns ?? [] });
    setEditorTab('general');
    setValidateState('idle');
    setPreview(null);
    setError('');
    setNotice('');
  }

  useEffect(() => {
    if (!editing) return;
    function onKey(event: KeyboardEvent) { if (event.key === 'Escape') setEditing(null); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing]);

  async function save() {
    if (!editing) return;
    setNotice('');
    setError('');
    // Client-side highlight validation: block save if any rule or condition is invalid
    const rules = (editing.highlightRules ?? []) as ReportHighlightRule[];
    for (const r of rules) {
      const conds = r.conditions ?? [];
      if (conds.length === 0) { setError('Each highlight rule needs at least one condition.'); setEditorTab('rules'); return; }
      if (conds.length > 5) { setError('Each highlight rule can have at most 5 conditions.'); setEditorTab('rules'); return; }
      for (const c of conds) {
        if (!c.column.trim()) { setError('Each highlight rule condition needs a column.'); setEditorTab('rules'); return; }
        const needsValue = c.operator !== 'is_empty' && c.operator !== 'is_not_empty';
        if (needsValue && !c.value.trim()) { setError(`Rule for "${c.column}" needs a value.`); setEditorTab('rules'); return; }
        if (!needsValue && c.value.trim()) { setError(`Rule for "${c.column}" must have an empty value for "${c.operator}".`); setEditorTab('rules'); return; }
      }
    }
    if (rules.length > 10) { setError('At most 10 highlight rules are allowed.'); setEditorTab('rules'); return; }
    // Normalize subreport fields (blank query => no subreport).
    const subreportQuery = (editing.subreportQuery ?? '').trim();
    const subreportKeyColumn = subreportQuery ? (editing.subreportKeyColumn ?? 'person_id').trim() || null : null;
    const columns = (editing.columns ?? []).filter((c) => c.trim()).length > 0 ? (editing.columns ?? []).filter((c) => c.trim()) : undefined;
    const additionalColumns = (editing.additionalColumns ?? []).map((c) => c.trim()).filter(Boolean).length > 0 ? (editing.additionalColumns ?? []).map((c) => c.trim()).filter(Boolean) : undefined;
    try {
      if (editing.id) {
        await updateReport(session, editing.id, {
          sectionId: editing.sectionId,
          title: editing.title,
          description: editing.description,
          sqlQuery: editing.sqlQuery,
          status: editing.status,
          highlightRules: rules,
          subreportQuery: subreportQuery || undefined,
          subreportKeyColumn: subreportKeyColumn,
          columns: columns,
          additionalColumns: additionalColumns
        });
        setNotice('Report updated.');
      } else {
        await createReport(session, {
          sectionId: editing.sectionId ?? '',
          title: editing.title ?? '',
          description: editing.description ?? '',
          sqlQuery: editing.sqlQuery ?? '',
          status: editing.status ?? 'inactive',
          highlightRules: rules,
          subreportQuery: subreportQuery || undefined,
          subreportKeyColumn: subreportKeyColumn,
          columns: columns,
          additionalColumns: additionalColumns
        });
        setNotice('Report created.');
      }
      setEditing(null);
      await refresh();
    } catch (failure) {
      const msg = failure instanceof Error ? failure.message : '';
      if (msg === 'HIGHLIGHT_RULE_INVALID') setEditorTab('rules');
      setError(errorMessage(failure, 'The report could not be saved.'));
    }
  }

  async function validate() {
    if (!editing?.sqlQuery) return;
    setValidateState('idle');
    setError('');
    // Validate main query first.
    try {
      await validateReportSql(session, editing.sqlQuery);
    } catch (failure) {
      setValidateState('fail');
      setError(errorMessage(failure, 'The SQL did not validate.'));
      return;
    }
    // If a subreport is present, validate the child query too.
    if (editing.subreportQuery?.trim()) {
      try {
        await validateReportSql(session, editing.subreportQuery, true);
        setValidateState('ok');
      } catch (subFailure) {
        setValidateState('fail');
        setError(errorMessage(subFailure, 'The subreport SQL did not validate (must be read-only and reference :person_id).'));
      }
      return;
    }
    setValidateState('ok');
  }

  async function previewRun() {
    if (!editing?.id || !previewOrg) return;
    setError('');
    setPreview(null);
    try {
      const run = await runReport(session, editing.id, previewOrg);
      setPreview({ columns: run.columns, rows: run.rows.slice(0, 5), subreport: run.subreport ?? null });
    } catch (failure) {
      setError(errorMessage(failure, 'The preview could not run.'));
    }
  }

  async function archiveReport(report: ReportDefinition) {
    if (report.status === 'inactive') return;
    if (!window.confirm(`Archive "${report.title}"? It will be set to Inactive and hidden from the catalog.`)) return;
    setNotice('');
    setError('');
    try {
      await updateReport(session, report.id, { status: 'inactive' });
      setNotice('Report archived.');
      await refresh();
    } catch (failure) {
      setError(errorMessage(failure, 'The report could not be archived.'));
    }
  }

  return <div className="settings-panel">
    {notice && <div className="notice success"><CheckCircle2 size={18} /><span>{notice}</span></div>}
    {error && <div className="notice error"><AlertCircle size={18} /><span>{error}</span></div>}
    <div className="settings-form-row">
      <label className="settings-field"><span>Filter reports</span><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter by title or section" /></label>
      <button className="export-button" onClick={startNew}><Plus size={17} />New report</button>
    </div>
    <div className="settings-table-wrap">
      <table className="report-table">
        <thead><tr><th>Title</th><th>Section</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>{visible.map((report) => <tr key={report.id} className="report-card">
          <td data-label="Title"><span><strong>{report.title}</strong><br />{report.description}</span></td>
          <td data-label="Section"><span>{report.sectionTitle ?? report.sectionId}</span></td>
          <td data-label="Status">{report.status === 'active' ? <span className="ready-badge">Active</span> : <span className="pending-badge">Inactive</span>}</td>
          <td data-label="Actions"><span className="settings-actions">
            <button className="back-button" onClick={() => startEdit(report)}><Pencil size={15} />Edit</button>
            <button className="back-button" onClick={() => void archiveReport(report)} disabled={report.status === 'inactive'} title={report.status === 'inactive' ? 'Already archived' : 'Archive report'}><Archive size={15} />Archive</button>
          </span></td>
        </tr>)}</tbody>
      </table>
    </div>
    {editing && <>
      <button className="settings-drawer-scrim" aria-label="Close report editor" onClick={() => setEditing(null)} />
      <div className="settings-editor settings-drawer" role="dialog" aria-modal="true" aria-label={editing.id ? 'Edit report' : 'New report'}>
      <div className="settings-drawer-heading">
        <h3>{editing.id ? 'Edit report' : 'New report'}</h3>
        <button className="icon-button subtle" aria-label="Close report editor" onClick={() => setEditing(null)}><X size={18} /></button>
      </div>
      <div className="position-detail-tabs" role="tablist" aria-label="Report editor tabs">
        <button role="tab" aria-selected={editorTab === 'general'} className={editorTab === 'general' ? 'position-detail-tab active' : 'position-detail-tab'} onClick={() => setEditorTab('general')}><FileText size={15} />General</button>
        <button role="tab" aria-selected={editorTab === 'rules'} className={editorTab === 'rules' ? 'position-detail-tab active' : 'position-detail-tab'} onClick={() => setEditorTab('rules')}><ListChecks size={15} />Rules</button>
        <button role="tab" aria-selected={editorTab === 'options'} className={editorTab === 'options' ? 'position-detail-tab active' : 'position-detail-tab'} onClick={() => setEditorTab('options')}><Settings2 size={15} />Options</button>
      </div>
      {editorTab === 'general' ? <>
        <label className="settings-field"><span>Title</span><input value={editing.title ?? ''} onChange={(event) => setEditing({ ...editing, title: event.target.value })} /></label>
        <label className="settings-field"><span>Description</span><input value={editing.description ?? ''} onChange={(event) => setEditing({ ...editing, description: event.target.value })} /></label>
        <div className="settings-form-row">
          <label className="settings-field"><span>Section</span>
            <select value={editing.sectionId ?? ''} onChange={(event) => setEditing({ ...editing, sectionId: event.target.value })}>
              {sections.map((section) => <option key={section.id} value={section.id}>{section.title}</option>)}
            </select>
          </label>
          <label className="settings-field"><span>Status</span>
            <select value={editing.status ?? 'inactive'} onChange={(event) => setEditing({ ...editing, status: event.target.value as 'active' | 'inactive' })}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
        </div>
        <label className="settings-field"><span>SQL query (must be a single SELECT referencing :organization)</span>
          <textarea value={editing.sqlQuery ?? ''} onChange={(event) => { setEditing({ ...editing, sqlQuery: event.target.value }); setValidateState('idle'); }} rows={10} spellCheck={false} />
        </label>
        <label className="settings-field"><span>Display columns (comma-separated, optional). Leave blank to use query columns.</span>
          <input
            value={(editing.columns ?? []).join(', ')}
            onChange={(event) => setEditing({ ...editing, columns: event.target.value.split(',').map((c) => c.trim()).filter(Boolean) })}
            placeholder="e.g. full_name, assignment, track, classroom"
          />
        </label>
        <div className="settings-form-row">
          <button className="back-button" onClick={() => void validate()}><CheckCircle2 size={16} />Validate</button>
          {validateState === 'ok' && <span className="ready-badge">Valid</span>}
          {validateState === 'fail' && <span className="pending-badge">Invalid</span>}
          {editing.id && <>
            <label className="settings-field" aria-label="Preview organization">
              <select value={previewOrg} onChange={(event) => setPreviewOrg(event.target.value)}>
                {schools.map((school) => <option key={school.id} value={school.name}>{school.name}</option>)}
              </select>
            </label>
            <button className="back-button" onClick={() => void previewRun()}><Play size={16} />Preview</button>
          </>}
        </div>
        {preview && <div className="settings-preview">
          <p><strong>Preview</strong> — first {preview.rows.length} of {preview.columns.length} columns{preview.subreport ? ' · with subreport' : ''}</p>
          <div className="report-table-wrap"><table className="report-table">
            <thead><tr>{preview.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
            <tbody>{preview.rows.map((row, index) => {
              const rules = (editing.highlightRules ?? []) as ReportHighlightRule[];
              let bg: string | undefined;
              for (const r of rules) {
                if (ruleMatchesRow(r, row)) { bg = HIGHLIGHT_PALETTE[r.color]?.bg; break; }
              }
              return <Fragment key={index}>
                <tr style={bg ? { background: bg } : undefined}>{preview.columns.map((column) => <td key={column}><span>{row[column] === null || row[column] === undefined ? '' : String(row[column])}</span></td>)}</tr>
                <SubreportPreviewCells sub={row.__subreport} colSpan={preview.columns.length} />
              </Fragment>;
            })}</tbody>
          </table></div>
        </div>}
      </> : editorTab === 'rules' ? <>
        <div className="settings-field"><span>Row Highlighting (optional)</span>
          <p className="highlight-desc">When a row matches a rule, the entire row is tinted. First matching rule wins. Within a rule, add multiple conditions and choose <strong>any (OR)</strong> or <strong>all (AND)</strong>. For the current year use <code>THISYEAR</code> (all caps) and next year use <code>NEXTYEAR</code> (all caps).</p>
          <RowHighlightingEditor
            rules={(editing.highlightRules ?? []) as ReportHighlightRule[]}
            onChange={(next) => setEditing({ ...editing, highlightRules: next })}
            columns={preview?.columns ?? []}
          />
          {preview && (editing.highlightRules ?? []).length > 0 && <div className="settings-preview" style={{ marginTop: 12 }}>
            <p><strong>Preview</strong> — tinted rows</p>
            <div className="report-table-wrap"><table className="report-table">
              <thead><tr>{preview.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
              <tbody>{preview.rows.map((row, index) => {
                const rules = (editing.highlightRules ?? []) as ReportHighlightRule[];
                let bg: string | undefined;
                for (const r of rules) {
                  if (ruleMatchesRow(r, row)) { bg = HIGHLIGHT_PALETTE[r.color]?.bg; break; }
                }
              return <Fragment key={index}>
                <tr style={bg ? { background: bg } : undefined}>{preview.columns.map((column) => <td key={column}><span>{row[column] === null || row[column] === undefined ? '' : String(row[column])}</span></td>)}</tr>
                <SubreportPreviewCells sub={row.__subreport} colSpan={preview.columns.length} />
              </Fragment>;
              })}</tbody>
            </table></div>
          </div>}
        </div>
      </> : <>
        <div className="settings-field"><span>Additional Columns (comma-delimited, optional)</span>
          <p className="highlight-desc">Blank columns appended to the end of the Excel export. Leave blank for none.</p>
          <label className="settings-field">
            <textarea
              value={(editing.additionalColumns ?? []).join(', ')}
              onChange={(event) => setEditing({ ...editing, additionalColumns: parseColumnList(event.target.value) })}
              rows={2}
              spellCheck={false}
              placeholder="effective_date, classroom_assign"
            />
          </label>
        </div>
        <div className="settings-field"><span>Subreport (optional)</span>
          <p className="highlight-desc">Add a child query that runs once per main row, bound to the row's key column. Child queries must be read-only and reference <code>:person_id</code>.</p>
          <label className="settings-field">
            <span>Subreport SQL (must be a single SELECT referencing :person_id)</span>
            <textarea
              value={editing.subreportQuery ?? ''}
              onChange={(event) => { setEditing({ ...editing, subreportQuery: event.target.value }); setValidateState('idle'); }}
              rows={8}
              spellCheck={false}
              placeholder="SELECT area, area_description AS area_desc, years, '' AS program, NCLB AS nclb_code FROM cert_area WHERE person_id = :person_id ORDER BY area"
            />
          </label>
          <label className="settings-field">
            <span>Subreport key column (row value bound to :person_id)</span>
            <input
              value={editing.subreportKeyColumn ?? 'person_id'}
              onChange={(event) => setEditing({ ...editing, subreportKeyColumn: event.target.value })}
              placeholder="person_id"
            />
          </label>
          <p className="highlight-hint">Leave Subreport SQL blank to disable the nested table for this report.</p>
        </div>
      </>}
      <div className="settings-form-row">
        <button className="export-button" onClick={() => void save()}>Save report</button>
        <button className="back-button" onClick={() => setEditing(null)}>Cancel</button>
      </div>
      </div>
    </>}
  </div>;
}

function FeaturesTab({ session }: { session: LoginSession }) {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    getFeatureFlag(session)
      .then((flag) => setEnabled(flag.enabled))
      .catch(() => setError('The feature flag could not be loaded.'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.user.id]);

  async function toggle(next: boolean) {
    setNotice('');
    setError('');
    setSaving(true);
    try {
      const flag = await setFeatureFlag(session, 'future_positions', next);
      setEnabled(flag.enabled);
      setNotice(flag.enabled ? 'Future Positions is now enabled.' : 'Future Positions is now disabled.');
    } catch (failure) {
      setError(errorMessage(failure, 'The feature flag could not be updated.'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="settings-panel"><div className="empty-state"><span className="loader" />Loading</div></div>;

  return <div className="settings-panel">
    <div className="settings-section">
      <h3 className="settings-section-title"><Flag size={16} />Future Positions</h3>
      <p className="settings-section-desc">When enabled, staff can stage a new incumbent directly from a position's detail page. The record stays <strong>pending</strong> for one hour before locking, then the data team reviews it and marks it <strong>completed</strong>.</p>
      <label className="toggle-row">
        <span className="toggle-row-label">Enable Future Positions</span>
        <span className="toggle-label">{enabled ? 'On' : 'Off'}</span>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          className={enabled ? 'switch switch-on' : 'switch'}
          disabled={saving}
          onClick={() => toggle(!enabled)}
        >
          <span className="switch-knob" />
        </button>
      </label>
      {notice && <p className="settings-notice">{notice}</p>}
      {error && <p className="settings-error">{error}</p>}
    </div>
  </div>;
}

export function SettingsPage({ session, schools }: { session: LoginSession; schools: School[] }) {
  const [tab, setTab] = useState<Tab>('reports');
  const [sections, setSections] = useState<ReportSection[]>([]);
  const [reports, setReports] = useState<ReportDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const isAdmin = session.user.roles.includes('hr_admin');

  async function refresh() {
    setError('');
    const [nextSections, nextReports] = await Promise.all([
      getReportSections(session, true),
      getReports(session, undefined, true)
    ]);
    setSections(nextSections);
    setReports(nextReports);
  }

  useEffect(() => {
    setLoading(true);
    refresh()
      .catch(() => setError('Settings could not be loaded.'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.user.id]);

  if (loading) return <section className="reports-page"><div className="empty-state"><span className="loader" />Loading settings</div></section>;

  return <section className="reports-page" aria-labelledby="settings-title">
    <div className="reports-page-heading">
      <div><p className="eyebrow">Admin</p><h2 id="settings-title">Report settings.</h2><p className="reports-intro">Organize report sections and author the SQL behind each report. Reports stay inactive until their SQL validates and you flip them active.</p></div>
    </div>
    {error && <div className="notice error"><AlertCircle size={18} /><span>{error}</span></div>}
    <div className="settings-tabs" role="tablist">
      <button role="tab" aria-selected={tab === 'reports'} className={tab === 'reports' ? 'settings-tab active' : 'settings-tab'} onClick={() => setTab('reports')}>Reports ({reports.length})</button>
      <button role="tab" aria-selected={tab === 'sections'} className={tab === 'sections' ? 'settings-tab active' : 'settings-tab'} onClick={() => setTab('sections')}>Sections ({sections.length})</button>
      {isAdmin && <button role="tab" aria-selected={tab === 'features'} className={tab === 'features' ? 'settings-tab active' : 'settings-tab'} onClick={() => setTab('features')}>Features</button>}
    </div>
    {tab === 'sections'
      ? <SectionsTab session={session} sections={sections} refresh={refresh} />
      : tab === 'features' && isAdmin
        ? <FeaturesTab session={session} />
        : <ReportsTab session={session} schools={schools} sections={sections} reports={reports} refresh={refresh} />}
  </section>;
}
