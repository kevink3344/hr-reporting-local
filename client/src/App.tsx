import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowUpRight, BarChart3, Building2, CalendarClock, Check, CheckCircle2, ChevronDown, ChevronUp, ClipboardCheck, Clock, Copy, Eye, EyeOff, FileText, Flag, Gauge, GripVertical, Home, Lock, LogOut, Menu, MessageSquare, Moon, Palette, Pencil, Pin, PinOff, Search, SearchCheck, Send, Settings2, SlidersHorizontal, Sun, Trash2, Unlock, UserPlus, Users, X } from 'lucide-react';
import { checkPositionPins, createPositionComment, createPositionPin, createFuturePosition, deletePositionComment, deletePositionPin, deletePositionPinByKey, getDirectory, getFeatureFlag, getFuturePositionForPosition, getHealthStatus, getPeople, getPersonRecord, getPositionComments, getPositionDetails, getPositionPins, getSchools, getStyleThemes, getSystemMessages, login, sendNowFuturePosition, unlockFuturePosition, updateFuturePosition } from './api';
import type { DirectoryPositionResult, DirectoryResult, FeatureFlagsResponse, FuturePosition, FuturePositionStatus, HealthStatus, KpiFacet, KpiMetricKey, KpiTarget, LoginSession, Person, PersonRecord, PositionComment, PositionDetails, School, SystemMessage } from './types';
import { PositionsPage } from './PositionsPage';
import { AdvancedSearchPage } from './AdvancedSearchPage';
import { FuturePositionsPage } from './FuturePositionsPage';
import { ReportsPage } from './ReportsPage';
import { KpiDashboardPage } from './KpiDashboardPage';
import { KpiDrilldownPage } from './KpiDrilldownPage';
import { KpiDefinitionPage } from './KpiDefinitionPage';
import { SettingsPage } from './SettingsPage';
import { FeaturesPage } from './FeaturesPage';
import { SystemInfoPage } from './SystemInfoPage';
import { StyleConfigurationPage } from './StyleConfigurationPage';
import { SystemMessagesPage } from './SystemMessagesPage';
import { AiAssistantPage } from './AiAssistantPage';
import { UserSettingsPage } from './UserSettingsPage';
import { SchoolCombobox } from './SchoolCombobox';
import { DEFAULT_RECORD_LAYOUT, RECORD_SECTION_TITLES, arraysEqual, hiddenSectionIds, loadRecordLayout, reorderVisibleSections, resetRecordLayout, saveRecordLayout, setSectionVisible, showAllSections, visibleSectionIds } from './recordLayout';
import type { RecordLayout, RecordSectionId } from './recordLayout';
import { DEFAULT_SECTION_COLORS, SECTION_COLOR_OPTIONS, clearSectionColor, loadSectionColors, saveSectionColor, sectionHeaderColor } from './sectionColors';
import { BUILT_IN_STYLES, DEFAULT_STYLE, applyStyle, loadLastAppliedStyle, loadStyleId, themeToDefinition } from './styleThemes';
import { loadHomePage, saveHomePage } from './homePage';
import type { HomePage } from './homePage';
import { addRecentPerson, clearRecentPeople, loadRecentPeople, removeRecentPerson, syncRecentPeople } from './recentPeople';
import { addRecentPosition, clearRecentPositions, loadRecentPositions, removeRecentPosition, syncRecentPositions } from './recentPositions';
import type { RecentPosition } from './recentPositions';
import { SystemMessageBody } from './systemMessageFormat';

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

// Shown on the sign-on screen when the reporting database cannot be reached.
// Sign-in is impossible in that state, so the form is disabled rather than
// letting every attempt fail.
const DB_UNAVAILABLE_MESSAGE = 'Database is currently unavailable. Please try again later.';

// How often the sign-on screen re-checks database reachability. Polling (rather
// than a single check on load) lets the form re-enable itself without a reload
// once the database comes back — e.g. when the campus network or VPN reconnects.
const HEALTH_POLL_MS = 15_000;

// Normalize a stored date value (mysql2 may return a JS Date, or a
// "YYYY-MM-DD HH:MM:SS" / full GMT string) into "YYYY-MM-DD" for the
// <input type="date"> fields in the Future Positions form.
function toDateInput(value: string | null | undefined): string {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
}

// `empty` is the label shown when the value is absent. Most fields use the
// generic "Not provided", but fields the sync pipeline deliberately NULLs
// (date of birth, personal email, address, phone) pass "Masked for testing" so
// an intentional redaction is not mistaken for missing source data.
function RecordField({ label, value, mono = false, empty = 'Not provided' }: { label: string; value: React.ReactNode; mono?: boolean; empty?: string }) {
  return <div className="record-field"><span>{label}</span><strong className={mono ? 'mono' : ''}>{value || empty}</strong></div>;
}

// Fields the masking policy NULLs outright. Rendered with a distinct label so
// the redaction is self-explanatory in the UI.
const MASKED_EMPTY = 'Masked for testing';

// Proposed salary toggle — the stored value is MONTHLY and is displayed as a
// monthly figure by default. Clicking the field toggles between monthly and
// yearly (yearly = monthly × 12).
function SalaryToggleField({ monthly, view, onToggle }: { monthly: number; view: 'monthly' | 'yearly'; onToggle: () => void }) {
  const yearly = monthly * 12;
  const isMonthly = view === 'monthly';
  const display = isMonthly ? money.format(monthly) : money.format(yearly);
  const suffix = isMonthly ? 'monthly' : 'yearly';
  return (
    <div
      className="record-field salary-toggle"
      role="button"
      tabIndex={0}
      aria-pressed={!isMonthly}
      title={isMonthly ? 'Show yearly salary' : 'Show monthly salary'}
      onClick={onToggle}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
    >
      <span>Proposed salary</span>
      <strong>{display} <em className="salary-period">{suffix}</em>
        <svg className="salary-toggle-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/></svg>
      </strong>
    </div>
  );
}

// Inline pastel color picker for a section header. Opens a small popover of
// swatches; picking one applies it to the header and persists it via the
// onSelect callback. The overall start color appears as a dot on the palette
// button.
function SectionColorPicker({ value, defaultColor, onSelect }: { value: string; defaultColor: string; onSelect: (color: string) => void }) {
  const [open, setOpen] = useState(false);
  function choose(color: string) {
    onSelect(color);
    setOpen(false);
  }
  return (
    <span className="record-color-picker" onClick={(e) => e.stopPropagation()}>
      <button
        className={`record-color-btn ${open ? 'open' : ''}`}
        aria-label="Change section color"
        title="Change section color"
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
      >
        <Palette size={13} />
      </button>
      {open && (
        <span className="record-color-menu" role="listbox" aria-label="Section color">
          {SECTION_COLOR_OPTIONS.map((option) => (
            <button
              key={option.id}
              className={`record-color-swatch ${value === option.value ? 'selected' : ''}`}
              title={option.name}
              aria-label={option.name}
              aria-pressed={value === option.value}
              style={{ background: option.value }}
              onClick={(e) => { e.stopPropagation(); choose(option.value); }}
            />
          ))}
          <button
            className="record-color-reset"
            title={`Reset to default (${defaultColor})`}
            aria-label="Reset to default color"
            onClick={(e) => { e.stopPropagation(); choose(defaultColor); }}
          >
            Reset
          </button>
        </span>
      )}
    </span>
  );
}

function DraggableRecordSection({
  id,
  title,
  tone = '',
  headerColor,
  customColor,
  defaultColor,
  onColorChange,
  index,
  total,
  isDragging,
  isDropTarget,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onMoveUp,
  onMoveDown,
  onToggleVisibility,
  hidden,
  theme,
  children,
}: {
  id: RecordSectionId;
  title: string;
  tone?: string;
  headerColor: string;
  customColor: string | null;
  defaultColor: string;
  onColorChange: (color: string) => void;
  index: number;
  total: number;
  isDragging: boolean;
  isDropTarget: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onToggleVisibility: () => void;
  hidden: boolean;
  theme: 'light' | 'dark';
  children: React.ReactNode;
}) {
  return <section
    className={`record-section ${tone} ${isDragging ? 'dragging' : ''} ${isDropTarget ? 'drag-over' : ''} ${hidden ? 'record-section-hidden' : ''}`}
    draggable
    onDragStart={onDragStart}
    onDragOver={onDragOver}
    onDrop={onDrop}
    onDragEnd={onDragEnd}
    aria-label={`${title} section, position ${index + 1} of ${total}, ${hidden ? 'hidden' : 'visible'}, draggable`}
  >
    <h4 draggable onDragStart={onDragStart} style={customColor ? { background: sectionHeaderColor(headerColor, theme) } : undefined}>
      <GripVertical size={14} className="record-drag-handle" aria-hidden="true" />
      <span className="record-section-title">{title}</span>
      <span className="record-section-actions">
        <button
          className={`record-visibility-btn ${hidden ? 'hidden' : ''}`}
          onClick={onToggleVisibility}
          aria-label={`${hidden ? 'Show' : 'Hide'} ${title}`}
          title={hidden ? 'Show section' : 'Hide section'}
        >
          {hidden ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
        <SectionColorPicker value={headerColor} defaultColor={defaultColor} onSelect={onColorChange} />
        <button className="record-move-btn" onClick={onMoveUp} disabled={index === 0} aria-label={`Move ${title} up`} title="Move up"><ChevronUp size={14} /></button>
        <button className="record-move-btn" onClick={onMoveDown} disabled={index === total - 1} aria-label={`Move ${title} down`} title="Move down"><ChevronDown size={14} /></button>
      </span>
    </h4>
    <div className="record-grid">{children}</div>
  </section>;
}

function EmployeeRecord({
  record,
  layout,
  userId,
  onClose,
  onReorder,
  onMoveUp,
  onMoveDown,
  onToggleVisibility,
  onOpenPosition,
  theme,
  layoutHint,
  canShowAll,
  onShowAllSections,
  onResetLayout,
  onSaveLayout,
  isLayoutDirty,
}: {
  record: PersonRecord;
  layout: RecordLayout;
  userId: string | null;
  onClose: () => void;
  onReorder: (from: number, to: number) => void;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
  onToggleVisibility: (id: RecordSectionId) => void;
  onOpenPosition: (posNumber: string, organization: string) => void;
  theme: 'light' | 'dark';
  layoutHint: string;
  canShowAll: boolean;
  onShowAllSections: () => void;
  onResetLayout: () => void;
  onSaveLayout: () => void;
  isLayoutDirty: boolean;
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [salaryView, setSalaryView] = useState<'monthly' | 'yearly'>('monthly');
  const [sectionColors, setSectionColors] = useState<Partial<Record<RecordSectionId, string>>>(() => loadSectionColors(userId));

  function handleColorChange(id: RecordSectionId, color: string) {
    const defaultColor = DEFAULT_SECTION_COLORS[id];
    if (color === defaultColor) {
      setSectionColors((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      clearSectionColor(userId, id);
    } else {
      setSectionColors((prev) => ({ ...prev, [id]: color }));
      saveSectionColor(userId, id, color);
    }
  }

  function handleDragStart(e: React.DragEvent, index: number) {
    setDragIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
  }
  function handleDragOver(e: React.DragEvent, index: number) {
    e.preventDefault();
    if (dragIndex !== null && dragIndex !== index) setDropIndex(index);
  }
  function handleDrop(e: React.DragEvent, index: number) {
    e.preventDefault();
    const from = dragIndex ?? Number(e.dataTransfer.getData('text/plain'));
    if (!Number.isNaN(from) && from !== index) onReorder(from, index);
    setDragIndex(null);
    setDropIndex(null);
  }
  function handleDragEnd() {
    setDragIndex(null);
    setDropIndex(null);
  }

  const renderers: Record<RecordSectionId, React.ReactNode> = {
    identity: <><RecordField label="NC UID" value={record.identity.ncUid} mono /><RecordField label="Employee ID" value={record.identity.employeeNumber} mono /><RecordField label="Gender" value={record.identity.gender} /><RecordField label="Ethnicity" value={record.identity.ethnicity} /><RecordField label="Date of birth" value={record.identity.dateOfBirth} empty={MASKED_EMPTY} /><RecordField label="Email" value={record.identity.email} /><RecordField label="Personal email" value={record.identity.personalEmail} empty={MASKED_EMPTY} /></>,
    contact: <><RecordField label="Address" value={record.contact.address} empty={MASKED_EMPTY} /><RecordField label="City" value={record.contact.city} empty={MASKED_EMPTY} /><RecordField label="State / ZIP" value={`${record.contact.state ?? ''} ${record.contact.zip ?? ''}`.trim()} mono empty={MASKED_EMPTY} /><RecordField label="Phone" value={record.contact.phone} mono empty={MASKED_EMPTY} /></>,
    assignment: <><RecordField label="Location" value={record.assignment.organization} /><RecordField label="Classroom" value={record.assignment.classroom} /><RecordField label="Position" value={record.assignment.positionNumber ? <button className="report-cell-link" onClick={() => onOpenPosition(record.assignment.positionNumber, record.assignment.organization)}>{(record.assignment.positionNumber.trim() ? record.assignment.positionNumber.trim() + ' - ' : '') + record.assignment.position}</button> : record.assignment.position} /><RecordField label="Account" value={record.assignment.accountCode} mono /><RecordField label="Months" value={record.assignment.months} /><RecordField label="TAP" value={`${record.assignment.tapPercent.toFixed(2)}%`} /><RecordField label="Pay grade" value={record.assignment.payGrade} /><RecordField label="Group" value={record.assignment.group} /><RecordField label="Mail stop" value={record.assignment.mailStop} /><RecordField label="School type" value={record.assignment.schoolType} /><RecordField label="Supervisor" value={record.assignment.supervisor} /></>,
    compensation: <><RecordField label="Step" value={record.compensation.step} /><SalaryToggleField monthly={record.compensation.proposedSalary} view={salaryView} onToggle={() => setSalaryView((v) => (v === 'monthly' ? 'yearly' : 'monthly'))} /><RecordField label="Fixed supplement" value={money.format(record.compensation.fixedSupplement)} /><RecordField label="Off scale" value={money.format(record.compensation.offScale)} /><RecordField label="Supplement" value={money.format(record.compensation.supplement)} /><RecordField label="TOS state" value={money.format(record.compensation.tosState)} /><RecordField label="TOS supplement" value={money.format(record.compensation.tosSupplement)} /><RecordField label="Teacher differential" value={money.format(record.compensation.teacherDifferential)} /></>,
    contract: <><RecordField label="Hire date" value={record.contract.hireDate} /><RecordField label="Continuous date" value={record.contract.continuousDate} /><RecordField label="Last changed" value={record.contract.lastChanged} /><RecordField label="Type" value={record.contract.type} /><RecordField label="Start" value={record.contract.start} /><RecordField label="End" value={record.contract.end} /><RecordField label="Renewal year" value={record.contract.renewalYear} /><RecordField label="Change type" value={record.contract.changeType} /><RecordField label="Board number" value={record.contract.boardNumber} mono /></>,
    licensure: <><RecordField label="Type" value={record.licensure.type} /><RecordField label="Renewal year" value={record.licensure.renewalYear} /><RecordField label="Expires" value={record.licensure.expires} /><div className="record-table-wrap"><table className="record-table"><thead><tr><th>Area</th><th>Description</th><th>Years</th><th>Status</th><th>Code</th></tr></thead><tbody>{record.licensure.areas.map((area) => <tr key={area.code}><td className="mono">{area.area}</td><td>{area.description}</td><td>{area.years}</td><td>{area.status}</td><td className="mono">{area.code}</td></tr>)}</tbody></table></div></>,
    service: <><RecordField label="Years of service" value={record.service.yearsOfService} /><RecordField label="Months of service" value={record.service.monthsOfService} /><RecordField label="Last updated" value={record.service.lastUpdated} /></>,
    leave: <><div className="record-table-wrap"><table className="record-table leave-table"><thead><tr><th>Leave type</th><th>Carryover</th><th>Accrued</th><th>Used</th><th>Adjustment</th><th>Balance</th><th>Rate</th><th>Updated</th></tr></thead><tbody>{record.leaveBalances.length === 0 ? <tr><td colSpan={8} className="record-table-empty">No leave balances found.</td></tr> : record.leaveBalances.map((leave) => <tr key={leave.leaveType}><td>{leave.leaveType}</td><td>{leave.carryover}</td><td>{leave.accrued}</td><td>{leave.used}</td><td>{leave.adjustment}</td><td><strong>{leave.balance}</strong></td><td>{leave.accrualRate}</td><td>{leave.lastUpdated}</td></tr>)}</tbody></table></div></>,
  };

  const tones: Partial<Record<RecordSectionId, string>> = { leave: 'leave-section' };

  // Only visible sections are rendered as expandable cards, numbered by their
  // position among the VISIBLE sections. Hidden sections are collapsed into a
  // compact "hidden" row (with a Show button) so the user can easily restore
  // them without reordering anything. Drag/up/down operate on visible ordering.
  const visibleOrder = visibleSectionIds(layout);
  const totalVisible = visibleOrder.length;

  return <div className="employee-record">
    <div className="record-title"><div><span className="record-active"><span className="status-dot" />Active</span><p className="eyebrow">Employee record</p><h3>{record.identity.fullName}</h3></div><div className="record-title-actions"><button className="icon-button record-close" onClick={onClose} aria-label="Close employee record" title="Close employee record"><X size={17} /></button></div></div>
    <div className="record-layout-actions" title={layoutHint}><button className="record-layout-link" onClick={onShowAllSections} disabled={!canShowAll}><Eye size={14} />Show all</button><button className="record-layout-link" onClick={onResetLayout}>Reset</button><button className="record-layout-link" onClick={onSaveLayout} disabled={!isLayoutDirty}><Check size={14} />Save layout</button></div>
    {layout.map((item) => {
      const visibleIndex = visibleOrder.indexOf(item.id);
      if (visibleIndex === -1) {
        return (
          <div className="record-hidden-row" key={item.id}>
            <span className="record-hidden-label"><EyeOff size={14} aria-hidden="true" />{RECORD_SECTION_TITLES[item.id]} <span className="record-hidden-tag">hidden</span></span>
            <button className="record-show-btn" onClick={() => onToggleVisibility(item.id)}>Show section</button>
          </div>
        );
      }
      return <DraggableRecordSection
        key={item.id}
        id={item.id}
        title={RECORD_SECTION_TITLES[item.id]}
        tone={tones[item.id] ?? ''}
        headerColor={sectionColors[item.id] ?? DEFAULT_SECTION_COLORS[item.id]}
        customColor={sectionColors[item.id] ?? null}
        defaultColor={DEFAULT_SECTION_COLORS[item.id]}
        onColorChange={(color) => handleColorChange(item.id, color)}
        index={visibleIndex}
        total={totalVisible}
        isDragging={dragIndex === visibleIndex}
        isDropTarget={dropIndex === visibleIndex}
        onDragStart={(e) => handleDragStart(e, visibleIndex)}
        onDragOver={(e) => handleDragOver(e, visibleIndex)}
        onDrop={(e) => handleDrop(e, visibleIndex)}
        onDragEnd={handleDragEnd}
        onMoveUp={() => onMoveUp(visibleIndex)}
        onMoveDown={() => onMoveDown(visibleIndex)}
        onToggleVisibility={() => onToggleVisibility(item.id)}
        hidden={false}
        theme={theme}
      >{renderers[item.id]}</DraggableRecordSection>;
    })}
  </div>;
}

// Status steps for a staged future incumbent. `pending` is the first step a
// record can be in, so it counts as step 1 (not "not started").
const FUTURE_STEPS: { status: FuturePositionStatus; label: string; Icon: typeof Clock }[] = [
  { status: 'pending', label: 'Pending', Icon: Clock },
  { status: 'locked', label: 'In review', Icon: Lock },
  { status: 'completed', label: 'Completed', Icon: CheckCircle2 }
];

// Horizontal progress stepper for the staged future incumbent. Steps before the
// current one are "done" (filled + check), the current one is highlighted, and
// steps after it are muted. Renders nothing when no record has been staged.
function FutureProgress({ status }: { status: FuturePositionStatus | null }) {
  if (!status) return null;
  const currentIndex = FUTURE_STEPS.findIndex((step) => step.status === status);
  if (currentIndex < 0) return null;

  return (
    <ol className="future-progress" aria-label="Future incumbent progress">
      {FUTURE_STEPS.map((step, index) => {
        const state = index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'todo';
        const { Icon } = step;
        return (
          <li key={step.status} className={`future-progress-step future-progress-step--${state}`}>
            <span className="future-progress-marker">
              <Icon size={15} />
            </span>
            {index < FUTURE_STEPS.length - 1 && <span className="future-progress-line" aria-hidden="true" />}
            <span className="future-progress-label">{step.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

// Read-only Position Details drawer — non-draggable, mirrors the field layout
// of the employee record but never reorders.
function PositionDetailView({ details, onClose, onOpenRecord, pinned, onTogglePin, session, futureEnabled }: { details: PositionDetails; onClose: () => void; onOpenRecord: (employeeNumber: string) => void; pinned: boolean; onTogglePin: () => void; session: LoginSession | null; futureEnabled: boolean }) {
  const [tab, setTab] = useState<'general' | 'notes'>('general');
  const [incumbentTab, setIncumbentTab] = useState<'current' | 'future'>('current');
  const [noteCount, setNoteCount] = useState(0);
  const [future, setFuture] = useState<FuturePosition | null>(null);
  const [futureLoading, setFutureLoading] = useState(false);
  const [futurePanelOpen, setFuturePanelOpen] = useState(false);
  const [futureSaving, setFutureSaving] = useState(false);
  const [futureError, setFutureError] = useState('');
  const [futureNotice, setFutureNotice] = useState('');
  const [toast, setToast] = useState('');
  const [futureForm, setFutureForm] = useState<{ incumbentName: string; employeeNumber: string; positionType: 'vacant' | 'replacement' | 'new'; hireDate: string; classroomAssigned: string; accountNumber: string; contractType: string; contractStartDate: string; contractEndDate: string; letterNeeded: 'Change' | 'Rehire' | 'Other' | ''; notes: string }>({ incumbentName: '', employeeNumber: '', positionType: 'vacant', hireDate: '', classroomAssigned: '', accountNumber: '', contractType: '', contractStartDate: '', contractEndDate: '', letterNeeded: '', notes: '' });
  // When set, the open panel edits this existing pending record instead of creating a new one.
  const [editingFutureId, setEditingFutureId] = useState<string | null>(null);
  const { position, incumbent, accountNumber, org, vacant } = details;
  // The backend stores submitted_by from the x-user-id header, which is
  // session.user.wakeId ?? session.user.id (see api.ts viewHeaders).
  const submitterId = session ? (session.user.wakeId || session.user.id) : null;

  // Populate the Notes tab badge on mount. The child notes tab keeps it in sync
  // via onCountChange after any add/delete, regardless of which tab is active.
  useEffect(() => {
    if (!session) { setNoteCount(0); return; }
    let active = true;
    getPositionComments(session, position.posNumber, org)
      .then((comments) => { if (active) setNoteCount(comments.length); })
      .catch(() => { if (active) setNoteCount(0); });
    return () => { active = false; };
  }, [session, position.posNumber, org]);

  // Load any existing pending future record for this position when the flag is on.
  useEffect(() => {
    if (!session || !futureEnabled) { setFuture(null); return; }
    let active = true;
    setFutureLoading(true);
    getFuturePositionForPosition(session, position.posNumber, org)
      .then((found) => { if (active) setFuture(found); })
      .catch(() => { if (active) setFuture(null); })
      .finally(() => { if (active) setFutureLoading(false); });
    return () => { active = false; };
  }, [session, position.posNumber, org, futureEnabled]);

  function resetFutureForm() {
    setFutureForm({ incumbentName: '', employeeNumber: '', positionType: 'vacant', hireDate: '', classroomAssigned: '', accountNumber: accountNumber || '', contractType: '', contractStartDate: '', contractEndDate: '', letterNeeded: '', notes: '' });
  }

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(''), 3000);
  }

  function copyIncumbentForm() {
    if (future?.status === 'locked') { showToast('Record is currently locked and cannot be edited'); return; }
    if (!incumbent) { setFutureError('This position has no current incumbent to copy.'); return; }
    setFutureError('');
    setFutureNotice('');
    setFutureForm((form) => ({
      ...form,
      incumbentName: incumbent.fullName || '',
      employeeNumber: incumbent.employeeNumber || '',
      accountNumber: accountNumber || form.accountNumber,
      classroomAssigned: incumbent.classroom || '',
      contractType: incumbent.contractType || '',
      contractStartDate: toDateInput(incumbent.contractStart),
      contractEndDate: toDateInput(incumbent.contractEnd)
    }));
    setEditingFutureId(null);
    setIncumbentTab('future');
    setFuturePanelOpen(true);
  }

  // Reopen an editable record in the form. Locked records must be unlocked back
  // to pending first, so editing stays a pending-only operation.
  function editFuture() {
    if (future?.status === 'locked') { showToast('Record is locked. Click Unlock to edit it.'); return; }
    if (!future) return;
    setFutureError('');
    setFutureNotice('');
    setFutureForm({
      incumbentName: future.incumbentName || '',
      employeeNumber: future.employeeNumber || '',
      positionType: future.positionType,
      hireDate: toDateInput(future.hireDate),
      classroomAssigned: future.classroomAssigned || '',
      accountNumber: future.accountNumber || accountNumber || '',
      contractType: future.contractType || '',
      contractStartDate: toDateInput(future.contractStartDate),
      contractEndDate: toDateInput(future.contractEndDate),
      letterNeeded: future.letterNeeded || '',
      notes: future.notes || ''
    });
    setEditingFutureId(future.id);
    setIncumbentTab('future');
    setFuturePanelOpen(true);
  }

  async function sendNow() {
    if (!session || !future || futureSaving) return;
    if (future.status === 'locked') { showToast('Record is locked. Click Unlock to edit it.'); return; }
    setFutureSaving(true);
    setFutureError('');
    setFutureNotice('');
    try {
      const updated = await sendNowFuturePosition(session, future.id);
      setFuture(updated);
      setFutureNotice('Record sent to the data team for review.');
    } catch (failure) {
      setFutureError(failure instanceof Error && failure.message.startsWith('HTTP_') ? 'The record could not be updated.' : (failure instanceof Error ? failure.message : 'The record could not be updated.'));
    } finally {
      setFutureSaving(false);
    }
  }

  // Return a locked record to Pending so staff can edit it again. Completed
  // records are terminal and deliberately cannot be unlocked.
  async function unlockFuture() {
    if (!session || !future || futureSaving) return;
    if (future.status === 'completed') { showToast('This record is completed and can no longer be unlocked'); return; }
    setFutureSaving(true);
    setFutureError('');
    setFutureNotice('');
    try {
      const updated = await unlockFuturePosition(session, future.id);
      setFuture(updated);
      setFutureNotice('Record unlocked and set back to Pending.');
    } catch (failure) {
      const code = failure instanceof Error ? failure.message : '';
      if (code.startsWith('HTTP_')) {
        setFutureError('The record could not be unlocked.');
      } else if (code === 'FUTURE_POSITION_COMPLETED') {
        setFutureError('This record is completed and can no longer be unlocked.');
      } else if (code === 'FUTURE_POSITION_NOT_LOCKED') {
        setFutureError('Only a locked record can be unlocked.');
      } else if (code === 'FUTURE_POSITION_NOT_FOUND') {
        setFutureError('The record no longer exists.');
      } else if (code === 'FEATURE_DISABLED') {
        setFutureError('Future Positions is currently disabled.');
      } else {
        setFutureError(code || 'The record could not be unlocked.');
      }
    } finally {
      setFutureSaving(false);
    }
  }

  async function submitFuture() {
    if (!session || futureSaving) return;
    if (!futureForm.incumbentName.trim()) { setFutureError('A name is required.'); return; }
    setFutureSaving(true);
    setFutureError('');
    setFutureNotice('');
    try {
      const payload = {
        posName: position.posName || `Position ${position.posNumber}`,
        ...futureForm,
        hireDate: futureForm.hireDate || null,
        classroomAssigned: futureForm.classroomAssigned || null,
        accountNumber: futureForm.accountNumber || accountNumber || undefined,
        contractType: futureForm.contractType || null,
        contractStartDate: futureForm.contractStartDate || null,
        contractEndDate: futureForm.contractEndDate || null,
        letterNeeded: futureForm.letterNeeded || null,
        notes: futureForm.notes || null
      };
      const wasEditing = Boolean(editingFutureId);
      const saved = wasEditing
        ? await updateFuturePosition(session, editingFutureId!, payload)
        : await createFuturePosition(session, position.posNumber, { ...payload, organization: org });
      setFuture(saved);
      setFuturePanelOpen(false);
      setEditingFutureId(null);
      setFutureNotice(wasEditing ? 'Record updated.' : 'Record saved as Pending. Click \'Send Now\' when you are ready to submit it for review.');
      resetFutureForm();
    } catch (failure) {
      setFutureError(failure instanceof Error && failure.message.startsWith('HTTP_') ? 'The record could not be saved.' : (failure instanceof Error ? failure.message : 'The record could not be saved.'));
    } finally {
      setFutureSaving(false);
    }
  }

  return <div className="employee-record">
    {toast && <div className="record-toast" role="status" aria-live="polite">{toast}</div>}
    <div className="record-title">
      <div>
        <span className={`record-status ${vacant ? 'record-status--vacant' : 'record-status--filled'}`}>
          <span className="status-dot" />{vacant ? 'Vacant' : 'Filled'}
        </span>
        <p className="eyebrow">Position details</p>
        <h3>{position.posName || `Position ${position.posNumber}`}</h3>
      </div>
      <div className="record-title-actions">
        <button className={`icon-button ${pinned ? 'position-pin-toggle--active' : 'position-pin-toggle'}`} onClick={onTogglePin} aria-label={pinned ? 'Unpin position' : 'Pin position'} title={pinned ? 'Unpin position' : 'Pin position'} aria-pressed={pinned}>
          {pinned ? <Pin size={17} fill="currentColor" /> : <PinOff size={17} />}
        </button>
        <button className="icon-button" onClick={onClose} aria-label="Close position details" title="Close position details"><X size={17} /></button>
      </div>
    </div>
    <div className="position-detail-tabs" role="tablist" aria-label="Position details sections">
      <button role="tab" aria-selected={tab === 'general'} className={`position-detail-tab ${tab === 'general' ? 'active' : ''}`} onClick={() => setTab('general')}>
        <FileText size={15} />General
      </button>
      <button role="tab" aria-selected={tab === 'notes'} className={`position-detail-tab ${tab === 'notes' ? 'active' : ''}`} onClick={() => setTab('notes')}>
        <MessageSquare size={15} />Notes{noteCount > 0 ? <span className="position-tab-badge">{noteCount}</span> : null}
      </button>
    </div>
    {tab === 'general' ? (
      <>
        <div className="record-grid">
          <RecordField label="Position number" value={position.posNumber} mono />
          <RecordField label="Account" value={accountNumber} mono />
          <RecordField label="Organization" value={org} />
          <RecordField label="Pos. starting" value={position.posStart} />
          <RecordField label="Pos. ending" value={position.posEnding} />
          <RecordField label="Months" value={position.months} />
          <RecordField label="Fund" value={position.fund} mono />
          <RecordField label="Purpose" value={position.purpose} mono />
          <RecordField label="Program" value={position.program} mono />
          <RecordField label="Object" value={position.object} mono />
          <RecordField label="Level" value={position.level} mono />
          <RecordField label="Cost center" value={position.costCenter} mono />
          <RecordField label="Administrator" value={position.administrator} />
          <RecordField label="Region" value={position.region} />
          <RecordField label="Location type" value={position.locType} />
          <RecordField label="SS200 code" value={position.ss200Code} />
          <RecordField label="Calendar" value={position.calendar} />
        </div>
        <div className="position-incumbent-title">
          <h4 className="record-section-title">Incumbent</h4>
        </div>
        {futureEnabled && <FutureProgress status={future?.status ?? null} />}
        <div className="position-incumbent-tabs" role="tablist" aria-label="Incumbent sections">
          <button role="tab" aria-selected={incumbentTab === 'current'} className={`position-incumbent-tab ${incumbentTab === 'current' ? 'active' : ''}`} onClick={() => setIncumbentTab('current')}>
            <Users size={15} />Current
          </button>
          {futureEnabled && (
            <button role="tab" aria-selected={incumbentTab === 'future'} className={`position-incumbent-tab ${incumbentTab === 'future' ? 'active' : ''}`} onClick={() => setIncumbentTab('future')}>
              <CalendarClock size={15} />Future
            </button>
          )}
          {futureEnabled && session && (
            <div className="future-position-actions">
                {incumbent && (
                  <button className="icon-button icon-button--bare" onClick={copyIncumbentForm} aria-label="Copy current incumbent into the form" title="Copy current incumbent">
                    <Copy size={16} />
                  </button>
                )}
                <button className="icon-button icon-button--bare" onClick={() => {
                  if (future?.status === 'locked') { showToast('Record is locked. Click Unlock to edit it.'); return; }
                  if (future?.status === 'pending') { editFuture(); return; }
                  setEditingFutureId(null);
                  setIncumbentTab('future'); setFuturePanelOpen((open) => !open); setFutureError(''); setFutureNotice('');
                }} aria-label="Stage a new incumbent" title="Stage a new incumbent (Future Positions)">
                  <UserPlus size={16} />
                </button>
            </div>
          )}
        </div>
        {(incumbentTab === 'current' || !futureEnabled) ? (
          incumbent ? (
            <div className="record-grid">
              <RecordField label="Name" value={<button className="report-cell-link" onClick={() => onOpenRecord(incumbent.employeeNumber)}>{incumbent.fullName}</button>} />
              <RecordField label="Employee no." value={<button className="report-cell-link" onClick={() => onOpenRecord(incumbent.employeeNumber)}>{incumbent.employeeNumber}</button>} mono />
              <RecordField label="Tenure code" value={`${incumbent.tenureCode}${incumbent.tenureDesc ? ` — ${incumbent.tenureDesc}` : ''}`} />
              <RecordField label="Contract type" value={incumbent.contractType} />
              <RecordField label="Contract ID" value={incumbent.contractId} mono />
              <RecordField label="Contract start" value={incumbent.contractStart} />
              <RecordField label="Contract end" value={incumbent.contractEnd} />
              <RecordField label="TAP" value={incumbent.tap} />
              <RecordField label="Months" value={incumbent.months} />
              <RecordField label="Classroom" value={incumbent.classroom} />
              <RecordField label="Mail stop" value={incumbent.mailstop} mono />
            </div>
          ) : (
            <div className="detail-placeholder"><Users size={24} /><p>No incumbent is assigned to this position.</p></div>
          )
        ) : (
          <>
            {futureEnabled && session && futurePanelOpen ? (
              <div className="future-position-panel">
                <div className="future-position-panel-head">
                  <span className="future-position-panel-title">{editingFutureId ? 'Edit incumbent' : 'Stage a new incumbent'}</span>
                  <button className="icon-button" onClick={() => { setEditingFutureId(null); setFuturePanelOpen(false); }} aria-label="Close panel" title="Close panel"><X size={16} /></button>
                </div>
                {futureLoading ? <div className="empty-state"><span className="loader" />Loading existing record</div> : (
                  <>
                    {future && future.status !== 'completed' && (
                      <div className="future-position-detail-head">
                        <strong className="future-position-detail-name">{future.incumbentName || 'Not provided'}</strong>
                        {future.status === 'locked' && <span className="future-position-existing-hint">Locked pending data team review.</span>}
                      </div>
                    )}
                    <div className="future-position-form">
                      <label className="future-position-field">
                        <span>New incumbent name</span>
                        <input type="text" value={futureForm.incumbentName} onChange={(e) => setFutureForm((f) => ({ ...f, incumbentName: e.target.value }))} placeholder="Full name" />
                      </label>
                      <label className="future-position-field">
                        <span>Employee number</span>
                        <input type="text" value={futureForm.employeeNumber} onChange={(e) => setFutureForm((f) => ({ ...f, employeeNumber: e.target.value }))} placeholder="e.g. 12345" />
                      </label>
                      <label className="future-position-field">
                        <span>Position type</span>
                        <select value={futureForm.positionType} onChange={(e) => setFutureForm((f) => ({ ...f, positionType: e.target.value as 'vacant' | 'replacement' | 'new' }))}>
                          <option value="vacant">Vacant</option>
                          <option value="replacement">Replacement</option>
                          <option value="new">New</option>
                        </select>
                      </label>
                      <label className="future-position-field">
                        <span>Effective date</span>
                        <input type="date" value={futureForm.hireDate} onChange={(e) => setFutureForm((f) => ({ ...f, hireDate: e.target.value }))} />
                      </label>
                      <label className="future-position-field">
                        <span>Classroom Assigned</span>
                        <input type="text" value={futureForm.classroomAssigned} onChange={(e) => setFutureForm((f) => ({ ...f, classroomAssigned: e.target.value }))} placeholder="Optional" />
                      </label>
                      <label className="future-position-field">
                        <span>Account number</span>
                        <input type="text" value={futureForm.accountNumber} onChange={(e) => setFutureForm((f) => ({ ...f, accountNumber: e.target.value }))} placeholder={accountNumber || 'Optional'} />
                      </label>
                      <label className="future-position-field">
                        <span>Contract Type</span>
                        <input type="text" value={futureForm.contractType} onChange={(e) => setFutureForm((f) => ({ ...f, contractType: e.target.value }))} placeholder="Optional" />
                      </label>
                      <label className="future-position-field">
                        <span>Contract Start Date</span>
                        <input type="date" value={futureForm.contractStartDate} onChange={(e) => setFutureForm((f) => ({ ...f, contractStartDate: e.target.value }))} />
                      </label>
                      <label className="future-position-field">
                        <span>Contract End Date</span>
                        <input type="date" value={futureForm.contractEndDate} onChange={(e) => setFutureForm((f) => ({ ...f, contractEndDate: e.target.value }))} />
                      </label>
                      <label className="future-position-field">
                        <span>Letter Needed</span>
                        <select value={futureForm.letterNeeded} onChange={(e) => setFutureForm((f) => ({ ...f, letterNeeded: e.target.value as 'Change' | 'Rehire' | 'Other' | '' }))}>
                          <option value="">—</option>
                          <option value="Change">Change</option>
                          <option value="Rehire">Rehire</option>
                          <option value="Other">Other</option>
                        </select>
                      </label>
                      <label className="future-position-field">
                        <span>Notes</span>
                        <textarea rows={3} value={futureForm.notes} onChange={(e) => setFutureForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Anything the data team should know" />
                      </label>
                      {futureError && <p className="future-position-error">{futureError}</p>}
                      {futureNotice && <p className="future-position-notice">{futureNotice}</p>}
                      <div className="future-position-actions">
                        <button className="back-button" type="button" disabled={futureSaving} onClick={() => { setEditingFutureId(null); setFuturePanelOpen(false); }}>Cancel</button>
                        <button className="export-button" type="button" disabled={futureSaving} onClick={() => void submitFuture()}><Check size={14} />{editingFutureId ? 'Save changes' : 'Save'}</button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <>
                {futureLoading ? <div className="empty-state"><span className="loader" />Loading existing record</div> : future ? (
                  <>
                    <div className="future-position-detail-head">
                      <strong className="future-position-detail-name">{future.incumbentName || 'Not provided'}</strong>
                      {future.status === 'locked' && <span className="future-position-existing-hint">Locked pending data team review.</span>}
                      {future.status === 'completed' && <span className="future-position-existing-hint">This replacement has been completed.</span>}
                    </div>
                    <div className="record-grid">
                      <RecordField label="New incumbent" value={future.incumbentName} />
                      <RecordField label="Employee no." value={future.employeeNumber} mono />
                      <RecordField label="Position type" value={future.positionType} />
                      <RecordField label="Effective date" value={toDateInput(future.hireDate)} />
                      <RecordField label="Classroom" value={future.classroomAssigned} />
                      <RecordField label="Account" value={future.accountNumber} mono />
                      <RecordField label="Contract type" value={future.contractType} />
                      <RecordField label="Contract start" value={toDateInput(future.contractStartDate)} />
                      <RecordField label="Contract end" value={toDateInput(future.contractEndDate)} />
                      <RecordField label="Letter needed" value={future.letterNeeded} />
                      <RecordField label="Submitted by" value={future.submittedByName} />
                    </div>
                    {future.notes && <p className="future-position-card-notes">{future.notes}</p>}
                    {future.status === 'pending' && submitterId !== null && submitterId === future.submittedBy && (
                      <div className="future-position-card-actions">
                        <button className="back-button" disabled={futureSaving} onClick={editFuture}><Pencil size={14} />Edit</button>
                        <button className="export-button" disabled={futureSaving} onClick={() => void sendNow()}><Send size={14} />Send now</button>
                      </div>
                    )}
                    {future.status === 'locked' && session && (
                      <div className="future-position-card-actions">
                        <button className="back-button" disabled={futureSaving} onClick={() => void unlockFuture()}><Unlock size={14} />Unlock</button>
                      </div>
                    )}
                  </>
                ) : (!futureEnabled || !session) ? null : (
                  <div className="detail-placeholder"><CalendarClock size={24} /><p>No future incumbent has been staged for this position.</p></div>
                )}
              </>
            )}
          </>
        )}
      </>
    ) : (
      <PositionNotesTab session={session} posNumber={position.posNumber} org={org} onCountChange={setNoteCount} />
    )}
  </div>;
}

// Notes (position comments) tab for the Position detail drawer.
function PositionNotesTab({ session, posNumber, org, onCountChange }: { session: LoginSession | null; posNumber: string; org: string; onCountChange: (count: number) => void }) {
  const [comments, setComments] = useState<PositionComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!session) { setComments([]); setLoading(false); return; }
    setLoading(true);
    setError('');
    try {
      const loaded = await getPositionComments(session, posNumber, org);
      setComments(loaded);
      onCountChange(loaded.length);
    } catch {
      setError('Notes could not be loaded.');
      onCountChange(0);
    } finally {
      setLoading(false);
    }
  }, [session, posNumber, org, onCountChange]);

  useEffect(() => { void load(); }, [load]);

  async function submitComment() {
    const body = draft.trim();
    if (!body || !session || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await createPositionComment(session, posNumber, { organization: org, body });
      setDraft('');
      await load();
    } catch {
      setError('The note could not be added.');
    } finally {
      setSubmitting(false);
    }
  }

  async function removeComment(id: string) {
    if (!session) return;
    try {
      await deletePositionComment(session, posNumber, id);
      const next = comments.filter((c) => c.id !== id);
      setComments(next);
      onCountChange(next.length);
    } catch {
      setError('The note could not be deleted.');
    }
  }

  const canPost = Boolean(session) && draft.trim().length > 0 && !submitting;

  return <div className="position-notes">
    <p className="position-notes-intro">Add a shared note for this position. Only the author can delete their own note.</p>
    <div className="position-notes-composer">
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Write a note for this position…"
        rows={3}
        maxLength={2000}
        disabled={!session}
      />
      <button className="export-button" onClick={() => void submitComment()} disabled={!canPost}>
        <Send size={15} />{submitting ? 'Adding…' : 'Add note'}
      </button>
    </div>
    {error && <p className="notice error">{error}</p>}
    {loading ? (
      <div className="empty-state"><span className="loader" />Loading notes</div>
    ) : comments.length === 0 ? (
      <div className="report-comments-empty">No notes yet for this position.</div>
    ) : (
      <div className="report-comments-list position-notes-list">
        {comments.map((comment) => (
          <div className="report-comment" key={comment.id}>
            <div className="report-comment-head">
              <strong>{comment.authorName}</strong>
              <span className="report-comment-time">{formatCommentTime(comment.createdAt)}</span>
            </div>
            <div className="report-comment-body">{comment.body}</div>
            {session && comment.authorId === session.user.wakeId && (
              <button className="link-button position-note-delete" onClick={() => void removeComment(comment.id)}>
                <Trash2 size={13} />Delete
              </button>
            )}
          </div>
        ))}
      </div>
    )}
  </div>;
}

function formatCommentTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function App() {
  const [session, setSession] = useState<LoginSession | null>(null);
  const [rememberMe, setRememberMe] = useState(() => {
    try { return window.localStorage.getItem('hr-report-remember-me') === '1'; } catch { return false; }
  });
  const [wakeId, setWakeId] = useState(() => {
    try {
      if (window.localStorage.getItem('hr-report-remember-me') === '1') {
        const raw = window.localStorage.getItem('hr-report-credentials');
        if (raw) { const parsed = JSON.parse(raw) as { wakeId?: string }; return parsed.wakeId ?? ''; }
      }
    } catch { /* ignore */ }
    return '';
  });
  const [employeeId, setEmployeeId] = useState(() => {
    try {
      if (window.localStorage.getItem('hr-report-remember-me') === '1') {
        const raw = window.localStorage.getItem('hr-report-credentials');
        if (raw) { const parsed = JSON.parse(raw) as { employeeId?: string }; return parsed.employeeId ?? ''; }
      }
    } catch { /* ignore */ }
    return '';
  });
  const [showEmployeeId, setShowEmployeeId] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const [autoLoginAttempted, setAutoLoginAttempted] = useState(false);
  // Reachability of the reporting database, as reported by GET /api/health.
  // `null` means "not known yet" — the sign-on form is never disabled on a
  // guess, only on a positive report that a required database is down.
  const [healthStatus, setHealthStatus] = useState<HealthStatus | null>(null);
  const [schools, setSchools] = useState<School[]>([]);
  // `people` holds the currently displayed directory rows. On landing it is the
  // user's recently searched people; after an explicit search it is the results.
  const [people, setPeople] = useState<Person[]>([]);
  // "Recently searched" people shown in the directory. Persisted per-user in
  // localStorage so the landing list reflects opened records (most-recent first).
  const [recentPeople, setRecentPeople] = useState<Person[]>(() => loadRecentPeople(session?.user.id ?? null));
  // True once the user runs an explicit search; clears when returning to recent.
  const [hasSearched, setHasSearched] = useState(false);
  // Unified search results (people + positions) for the searched state. The
  // landing/recent view still uses `people` + `recentPositions` below.
  const [results, setResults] = useState<DirectoryResult[]>([]);
  // "Recently searched" positions, persisted per-user (parallel to recentPeople).
  const [recentPositions, setRecentPositions] = useState<RecentPosition[]>([]);
  const [search, setSearch] = useState('');
  const [schoolId, setSchoolId] = useState('');
  const [selectedPerson, setSelectedPerson] = useState<Person | null>(null);
  const [personRecord, setPersonRecord] = useState<PersonRecord | null>(null);
  const [recordLoading, setRecordLoading] = useState(false);
  const [recordError, setRecordError] = useState('');
  const [positionDetails, setPositionDetails] = useState<PositionDetails | null>(null);
  const [positionLoading, setPositionLoading] = useState(false);
  const [positionError, setPositionError] = useState('');
  const [positionPin, setPositionPin] = useState<{ pinned: boolean; pinId: string | null }>({ pinned: false, pinId: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeView, setActiveView] = useState<'home' | 'reports' | 'positions' | 'advanced-search' | 'kpi' | 'kpi-drilldown' | 'kpi-definition' | 'settings' | 'future-positions' | 'ai' | 'style-config' | 'features' | 'system-messages' | 'system-info'>('home');
  // Clickable KPI dashboard: the selected school is shared by all three KPI
  // views, and the drill-down/definition screens are driven by these targets.
  const [kpiSchoolId, setKpiSchoolId] = useState('');
  const [kpiTarget, setKpiTarget] = useState<KpiTarget | null>(null);
  const [kpiDefinitionMetric, setKpiDefinitionMetric] = useState<KpiMetricKey>('vacant');
  // Set when the definition page sends us to a list. The facet rides along
  // because a metric with no tile (active-staff) has no dashboard payload entry
  // the dashboard could read a default facet from.
  const [kpiPendingRequest, setKpiPendingRequest] = useState<{ metric: KpiMetricKey; facet: KpiFacet } | null>(null);
  const [homePage, setHomePage] = useState<HomePage>('home');
  const [userSettingsOpen, setUserSettingsOpen] = useState(false);
  const [positionPinsCount, setPositionPinsCount] = useState(0);
  const isAdmin = session?.user.roles.includes('hr_admin') ?? false;
  const isDataTeam = session?.user.roles.includes('data_team') ?? false;
  // Feature flags — Future Positions toggle (admin-controlled, gates the '+' button).
  const [futureEnabled, setFutureEnabled] = useState(false);
  // Feature flags — AI Assistant toggle (admin-controlled, gates the AI nav + page).
  const [aiEnabled, setAiEnabled] = useState(false);
  // Feature flags — Style Configuration toggle (admin-controlled, gates the page).
  // No nav item: the page is reached only from the Features page, exactly like
  // System-wide messages, so this flag just decides whether that entry works.
  const [styleConfigEnabled, setStyleConfigEnabled] = useState(false);
  // Feature flags — KPI Dashboard toggle (admin-controlled, gates the nav + views).
  // Defaults ON and stays ON when the flags request fails: the dashboard is
  // already live, so only an explicit "off" from the server may hide it.
  const [kpiEnabled, setKpiEnabled] = useState(true);
  // Feature flags — System-wide messages toggle (admin-controlled, gates the
  // message page and the announcements themselves). Opt-out like the KPI
  // Dashboard: it is already in use, so only an explicit "off" hides it.
  const [systemMessagesEnabled, setSystemMessagesEnabled] = useState(true);
  // Feature flags — System Information toggle (admin-controlled, gates the
  // beta diagnostics page). Opt-IN like the other betas: it ships hidden and
  // only an explicit "on" from the server reveals it.
  const [systemInfoEnabled, setSystemInfoEnabled] = useState(false);
  // Feature flags — Advanced Search. Opt-IN like the other betas, so the page
  // and its nav entry stay hidden until an admin turns it on from Features.
  const [advancedSearchEnabled, setAdvancedSearchEnabled] = useState(false);
  // System-wide messages: active announcements loaded from the server, plus
  // the set the current user has dismissed (per-user, persisted in localStorage).
  const [systemMessages, setSystemMessages] = useState<SystemMessage[]>([]);
  const [dismissedMessages, setDismissedMessages] = useState<Set<string>>(new Set());
  const [splashSeen, setSplashSeen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = window.localStorage.getItem('hr-report-theme');
    return saved === 'dark' ? 'dark' : 'light';
  });
  const [recordLayout, setRecordLayout] = useState<RecordLayout>(() => loadRecordLayout(null));
  const savedLayoutRef = useRef<RecordLayout>(loadRecordLayout(null));
  const [layoutNotice, setLayoutNotice] = useState('');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem('hr-report-theme', theme);
  }, [theme]);

  useEffect(() => {
    const next = loadRecordLayout(session?.user.id ?? null);
    setRecordLayout(next);
    savedLayoutRef.current = next;
  }, [session?.user.id]);

  // On user change (login / auto-login), restore their saved home page and land there.
  const sessionUserId = session?.user.id ?? null;
  useEffect(() => {
    const page = sessionUserId ? loadHomePage(sessionUserId) : 'home';
    setHomePage(page);
    // Every HomePage value is a valid view, so the preference *is* the landing
    // view: 'home' | 'reports' | 'kpi'. No translation table to keep in sync.
    setActiveView(page);
  }, [sessionUserId]);

  function changeHomePage(page: HomePage) {
    setHomePage(page);
    if (session) saveHomePage(session.user.id, page);
  }

  // Load active system-wide messages on user change. Splash overlays show only
  // once per login (reset when the user changes); banner dismissal is stored
  // per-user in localStorage keyed by `${userId}:${messageId}:${updatedAt}`, so
  // editing a banner re-surfaces it after it was dismissed.
  useEffect(() => {
    if (!session) {
      setSystemMessages([]);
      setSplashSeen(false);
      setDismissedMessages(new Set());
      return;
    }
    let cancelled = false;
    getSystemMessages(session).then((list) => {
      if (cancelled) return;
      setSystemMessages(list);
    }).catch(() => {
      if (cancelled) return;
      setSystemMessages([]);
    });
    setSplashSeen(false);
    const dismissed = new Set<string>();
    loadDismissedFromStorage(dismissed);
    setDismissedMessages(dismissed);
    return () => { cancelled = true; };
  }, [session?.user?.id]);

  // Load the feature flags on user change.
  useEffect(() => {
    if (!session) { setFutureEnabled(false); setAiEnabled(false); setStyleConfigEnabled(false); setKpiEnabled(true); setSystemMessagesEnabled(true); setSystemInfoEnabled(false); setAdvancedSearchEnabled(false); return; }
    let cancelled = false;
    getFeatureFlag(session)
      .then((flags) => {
        if (cancelled) return;
        setFutureEnabled(flags.future_positions);
        setAiEnabled(flags.ai_assistant);
        setStyleConfigEnabled(flags.style_configuration);
        setKpiEnabled(flags.kpi_dashboard);
        setSystemMessagesEnabled(flags.system_messages);
        setSystemInfoEnabled(flags.system_info);
        setAdvancedSearchEnabled(flags.advanced_search);
      })
      // The KPI Dashboard and System-wide messages are opt-out, so a failed
      // request leaves them on; the other flags are opt-in and fail closed.
      .catch(() => { if (!cancelled) { setFutureEnabled(false); setAiEnabled(false); setStyleConfigEnabled(false); setKpiEnabled(true); setSystemMessagesEnabled(true); setSystemInfoEnabled(false); setAdvancedSearchEnabled(false); } });
    return () => { cancelled = true; };
  }, [session?.user?.id]);

  // A disabled feature has to be unreachable, not merely unlinked. Each flag here
  // guards a view the user could already be sitting on when an admin flips it
  // off - and the server gates the same routes, so leaving them there renders a
  // page of 403s with no nav item left to leave by. Bounce to Home as soon as the
  // flag is known to be off. This also covers a saved home-page preference (say
  // "kpi") landing on a view that is now hidden.
  useEffect(() => {
    const stranded =
      (!kpiEnabled && (activeView === 'kpi' || activeView === 'kpi-drilldown' || activeView === 'kpi-definition')) ||
      (!aiEnabled && activeView === 'ai') ||
      (!styleConfigEnabled && activeView === 'style-config') ||
      (!futureEnabled && activeView === 'future-positions') ||
      (!systemMessagesEnabled && activeView === 'system-messages') ||
      (!systemInfoEnabled && activeView === 'system-info') ||
      (!advancedSearchEnabled && activeView === 'advanced-search');
    if (stranded) setActiveView('home');
  }, [kpiEnabled, aiEnabled, styleConfigEnabled, futureEnabled, systemMessagesEnabled, systemInfoEnabled, advancedSearchEnabled, activeView]);

  // Apply the signed-in user's saved style. Built-in styles resolve locally;
  // an admin-authored style is fetched from the server. Falls back to default.
  // On the sign-in screen (no session) we re-apply the last style used on this
  // device from the local cache so the login screen matches the workspace.
  useEffect(() => {
    if (!session) { applyStyle(loadLastAppliedStyle()); return; }
    const styleId = loadStyleId(session.user.id);
    const builtIn = BUILT_IN_STYLES.find((style) => style.id === styleId);
    if (builtIn) { applyStyle(builtIn); return; }
    let cancelled = false;
    getStyleThemes(session)
      .then((themes) => {
        if (cancelled) return;
        const theme = themes.find((item) => item.id === styleId);
        applyStyle(theme ? themeToDefinition(theme) : DEFAULT_STYLE);
      })
      .catch(() => { if (!cancelled) applyStyle(DEFAULT_STYLE); });
    return () => { cancelled = true; };
  }, [session?.user?.id]);

  // Per-user banner dismissal, keyed by `${userId}:${messageId}:${updatedAt}`.
  const bannerStorageKey = (messageId: string, updatedAt?: string) =>
    `${session?.user?.id ?? 'anon'}:${messageId}:${updatedAt ?? ''}`;

  function dismissBanner(message: SystemMessage) {
    if (!session) return;
    setDismissedMessages((prev) => {
      const next = new Set(prev);
      next.add(bannerStorageKey(message.id, message.updatedAt));
      try { window.localStorage.setItem('hr-report-banner-dismissed', JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }

  function loadDismissedFromStorage(keys: Set<string>) {
    try {
      const raw = window.localStorage.getItem('hr-report-banner-dismissed');
      if (!raw) return;
      const list = JSON.parse(raw) as string[];
      for (const key of list) keys.add(key);
    } catch { /* ignore */ }
  }

  // True only when the active data source genuinely needs a database and that
  // database is not answering. Fixture-backed deployments need no database, so
  // they are never gated. Unknown status (`null`) is also not a gate.
  const databaseUnavailable = healthStatus !== null && healthStatus.dbRequired && !healthStatus.dbReady;

  // The blocking database notice outranks any earlier sign-in error — while the
  // database is down the previous failure explains nothing the user can act on.
  const loginNotice = databaseUnavailable ? DB_UNAVAILABLE_MESSAGE : loginError;

  // Poll database reachability while signed out. Sign-in reads the user
  // directory out of the database, so an unreachable database makes every
  // attempt fail — the form is disabled and the reason shown instead. The
  // poll is a self-rescheduling timeout (never an interval) so a slow probe
  // can never stack requests, and it stops entirely once a session exists.
  useEffect(() => {
    if (session) return;
    let cancelled = false;
    let timer: number | undefined;
    async function check() {
      try {
        const status = await getHealthStatus();
        if (!cancelled) setHealthStatus(status);
      } catch {
        // The API itself is unreachable rather than the database. Leave the
        // status unknown so the form stays usable — submitting it reports the
        // sign-in service as unavailable, which is the accurate message.
        if (!cancelled) setHealthStatus(null);
      } finally {
        if (!cancelled) timer = window.setTimeout(() => void check(), HEALTH_POLL_MS);
      }
    }
    void check();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [session]);

  // Auto-login: if user previously checked "Stay signed in", restore session without showing login form.
  useEffect(() => {
    if (session || autoLoginAttempted) return;
    if (healthStatus === null || databaseUnavailable) return;
    let cancelled = false;
    try {
      const shouldRemember = window.localStorage.getItem('hr-report-remember-me') === '1';
      const raw = window.localStorage.getItem('hr-report-credentials');
      if (!shouldRemember || !raw) { setAutoLoginAttempted(true); return; }
      const parsed = JSON.parse(raw) as { wakeId?: string; employeeId?: string };
      const w = parsed.wakeId?.trim();
      const e = parsed.employeeId?.trim();
      if (!w || !e) { setAutoLoginAttempted(true); return; }
      setLoggingIn(true);
      login(w, e).then((nextSession) => {
        if (cancelled) return;
        setSession(nextSession);
        setWakeId(w);
        setEmployeeId(e);
        setRememberMe(true);
      }).catch((loginFailure: unknown) => {
        if (cancelled) return;
        // A database outage is not a credential problem: keep the remembered
        // credentials so the next launch (with the database back) still signs
        // in automatically. Only a real rejection forgets them.
        if (loginFailure instanceof Error && loginFailure.message === 'DB_UNAVAILABLE') return;
        try {
          window.localStorage.removeItem('hr-report-credentials');
          window.localStorage.removeItem('hr-report-remember-me');
        } catch { /* ignore */ }
      }).finally(() => {
        if (cancelled) return;
        setLoggingIn(false);
        setAutoLoginAttempted(true);
      });
    } catch {
      setAutoLoginAttempted(true);
    }
    return () => { cancelled = true; };
  }, [session, autoLoginAttempted, healthStatus, databaseUnavailable]);

  function reorderRecordSection(from: number, to: number) {
    setRecordLayout((prev) => reorderVisibleSections(prev, from, to));
  }
  function moveRecordSectionUp(index: number) {
    if (index <= 0) return;
    setRecordLayout((prev) => reorderVisibleSections(prev, index, index - 1));
  }
  function moveRecordSectionDown(index: number) {
    setRecordLayout((prev) => {
      const visibleCount = visibleSectionIds(prev).length;
      if (index >= visibleCount - 1) return prev;
      return reorderVisibleSections(prev, index, index + 1);
    });
  }
  function toggleSectionVisibility(id: RecordSectionId) {
    setRecordLayout((prev) => setSectionVisible(prev, id, !(prev.find((item) => item.id === id)?.visible ?? true)));
  }
  function showAllSectionsNow() {
    setRecordLayout((prev) => showAllSections(prev));
  }
  function saveRecordLayoutState() {
    saveRecordLayout(session?.user.id ?? null, recordLayout);
    savedLayoutRef.current = recordLayout.map((item) => ({ ...item }));
    setLayoutNotice('Layout saved');
    window.setTimeout(() => setLayoutNotice(''), 2000);
  }
  function resetRecordLayoutState() {
    resetRecordLayout(session?.user.id ?? null);
    setRecordLayout([...DEFAULT_RECORD_LAYOUT]);
    savedLayoutRef.current = [...DEFAULT_RECORD_LAYOUT];
    setLayoutNotice('Layout reset');
    window.setTimeout(() => setLayoutNotice(''), 2000);
  }
  const isLayoutDirty = !arraysEqual(recordLayout, savedLayoutRef.current);
  const hiddenLayoutCount = hiddenSectionIds(recordLayout).length;

  async function submitLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Guard the disabled attribute: the form can be submitted from the keyboard
    // (Enter in a field) and by an automated client regardless of button state.
    if (databaseUnavailable || loggingIn) return;
    setLoggingIn(true);
    setLoginError('');
    try {
      const nextSession = await login(wakeId, employeeId);
      setSession(nextSession);
      try {
        if (rememberMe) {
          window.localStorage.setItem('hr-report-remember-me', '1');
          window.localStorage.setItem('hr-report-credentials', JSON.stringify({ wakeId, employeeId }));
        } else {
          window.localStorage.removeItem('hr-report-remember-me');
          window.localStorage.removeItem('hr-report-credentials');
        }
      } catch { /* ignore */ }
    } catch (loginFailure) {
      const code = loginFailure instanceof Error ? loginFailure.message : '';
      setLoginError(code === 'INVALID_CREDENTIALS'
        ? 'Wake ID and Employee ID did not match a user in the system.'
        : code === 'DB_UNAVAILABLE'
          // The database went away between the health poll and this attempt;
          // the poll below will surface it as the blocking notice.
          ? DB_UNAVAILABLE_MESSAGE
          : 'The sign-in service is unavailable.');
    } finally {
      setLoggingIn(false);
    }
  }

  function signOut() {
    setSession(null);
    setSelectedPerson(null);
    setPeople([]);
    setActiveView('home');
    setMenuOpen(false);
    try {
      window.localStorage.removeItem('hr-report-remember-me');
      window.localStorage.removeItem('hr-report-credentials');
    } catch { /* ignore */ }
  }

  // Apply a flag change that came from an admin toggle. Anything the shell has
  // already rendered reads from this state - nav items, gated views, and the
  // future-incumbent panel on a position - so setting it here makes the toggle
  // take effect straight away instead of at the next page load.
  function applyFlags(flags: Partial<FeatureFlagsResponse>) {
    if (typeof flags.future_positions === 'boolean') setFutureEnabled(flags.future_positions);
    if (typeof flags.ai_assistant === 'boolean') setAiEnabled(flags.ai_assistant);
    if (typeof flags.style_configuration === 'boolean') setStyleConfigEnabled(flags.style_configuration);
    if (typeof flags.kpi_dashboard === 'boolean') setKpiEnabled(flags.kpi_dashboard);
    if (typeof flags.system_messages === 'boolean') setSystemMessagesEnabled(flags.system_messages);
    if (typeof flags.system_info === 'boolean') setSystemInfoEnabled(flags.system_info);
    if (typeof flags.advanced_search === 'boolean') setAdvancedSearchEnabled(flags.advanced_search);
  }

  function navigate(view: 'home' | 'reports' | 'positions' | 'advanced-search' | 'kpi' | 'settings' | 'future-positions' | 'ai' | 'style-config' | 'features' | 'system-messages' | 'system-info') {
    if (view === 'settings' && !isAdmin) return;
    if (view === 'future-positions' && !isDataTeam) return;
    if (view === 'ai' && !aiEnabled) return;
    if (view === 'style-config' && !styleConfigEnabled) return;
    if (view === 'kpi' && !kpiEnabled) return;
    if (view === 'advanced-search' && !advancedSearchEnabled) return;
    if (view === 'future-positions' && !futureEnabled) return;
    if (view === 'features' && !isAdmin) return;
    if (view === 'system-messages' && !isAdmin) return;
    if (view === 'system-messages' && !systemMessagesEnabled) return;
    if (view === 'system-info' && !isAdmin) return;
    if (view === 'system-info' && !systemInfoEnabled) return;
    setActiveView(view);
    setMenuOpen(false);
  }

  /**
   * The KPI views are all clickable, so navigation between them is not a plain
   * `navigate()` call: a tile or bar hands over the exact list to open, and the
   * definition page is reachable from both a tile's ⓘ and a list's heading.
   */
  function openKpiList(target: KpiTarget) {
    setKpiTarget(target);
    setKpiPendingRequest(null);
    setActiveView('kpi-drilldown');
    setMenuOpen(false);
  }

  function openKpiDefinition(metric: KpiMetricKey) {
    setKpiDefinitionMetric(metric);
    setActiveView('kpi-definition');
    setMenuOpen(false);
  }

  function openKpiListFromDefinition(metric: KpiMetricKey, facet: KpiFacet) {
    setKpiTarget(null);
    setKpiPendingRequest({ metric, facet });
    setActiveView('kpi');
    setMenuOpen(false);
  }

  // Preselect the user's own school when they are scoped to exactly one. Users
  // who can view everything pick a school themselves — the KPI endpoints are
  // per-school, so there is no "all schools" dashboard.
  useEffect(() => {
    if (!session || schools.length === 0) return;
    setKpiSchoolId((current) => {
      if (current && schools.some((school) => school.id === current)) return current;
      if (session.user.canViewAllSchools) return '';
      const scoped = schools.filter((school) => session.user.schoolIds.includes(school.id));
      return scoped.length === 1 ? scoped[0].id : '';
    });
  }, [session, schools]);

  // Keep pinned-position count fresh for nav badge
  useEffect(() => {
    if (!session) { setPositionPinsCount(0); return; }
    getPositionPins(session, { page: 1, pageSize: 1 }).then((res) => setPositionPinsCount(res.total)).catch(() => {});
  }, [session, activeView]);

  // Position pin state for the currently-open position drawer.
  const [positionPinId, setPositionPinId] = useState<string | null>(null);
  const [positionPinned, setPositionPinned] = useState(false);
  useEffect(() => {
    if (!session || !positionDetails) { setPositionPinned(false); setPositionPinId(null); return; }
    const posNumber = positionDetails.position.posNumber;
    const org = positionDetails.org;
    checkPositionPins(session, [{ posNumber, organization: org }]).then((checks) => {
      setPositionPinned(checks[0]?.pinned ?? false);
      setPositionPinId(checks[0]?.pinId ?? null);
    }).catch(() => { setPositionPinned(false); setPositionPinId(null); });
  }, [session, positionDetails]);

  async function togglePositionPin() {
    if (!session || !positionDetails) return;
    const posNumber = positionDetails.position.posNumber;
    const org = positionDetails.org;
    const posName = positionDetails.position.posName || `Position ${posNumber}`;
    const incumbent = positionDetails.incumbent;
    try {
      if (positionPinned) {
        if (positionPinId) await deletePositionPin(session, positionPinId);
        else await deletePositionPinByKey(session, posNumber, org);
        setPositionPinned(false);
        setPositionPinId(null);
      } else {
        const created = await createPositionPin(session, {
          posNumber,
          posName,
          organization: org,
          incumbentName: incumbent?.fullName ?? null,
          employeeNumber: incumbent?.employeeNumber ?? null
        });
        setPositionPinned(true);
        setPositionPinId(created.id);
      }
      getPositionPins(session, { page: 1, pageSize: 1 }).then((res) => setPositionPinsCount(res.total)).catch(() => {});
    } catch {
      // no-op; keep current state on failure
    }
  }

  useEffect(() => {
    if (!session) return;
    // Landing list is the user's recently searched people, not the first page
    // of the directory. The full directory is only fetched on an explicit search.
    const recent = loadRecentPeople(session.user.id);
    setRecentPeople(recent);
    setRecentPositions(loadRecentPositions(session.user.id));
    // Then reconcile both lists with the server, which is what makes the recents
    // follow the user to a different browser. `syncRecent*` never rejects: on any
    // server problem they resolve to the cache we just painted.
    void Promise.all([
      syncRecentPeople(session, session.user.id),
      syncRecentPositions(session, session.user.id)
    ]).then(([nextPeople, nextPositions]) => {
      setRecentPeople(nextPeople);
      setRecentPositions(nextPositions);
    });
    void getSchools(session)
      .then((nextSchools) => {
        setSchools(nextSchools);
        // When a user can only see one school, default the People filter to it
        // so the directory and dropdown reflect their own school only.
        const restricted = !session.user.canViewAllSchools;
        if (restricted && nextSchools.length === 1) {
          setSchoolId(nextSchools[0].id);
        }
      })
      .catch(() => setError('The lookup service is unavailable. Check that the API is running.'))
      .finally(() => setLoading(false));
  }, [session]);

  async function runSearch() {
    const trimmed = search.trim();
    if (!trimmed) return;
    setLoading(true);
    setError('');
    // Performing an explicit search switches the directory to search results.
    setHasSearched(true);
    try {
      const result = await getDirectory(trimmed, schoolId, session);
      setResults(result.data);
      setSelectedPerson(null);
      setPersonRecord(null);
    } catch {
      setError('The lookup could not be completed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function selectPerson(person: Person) {
    setSelectedPerson(person);
    setPersonRecord(null);
    setRecordError('');
    setRecordLoading(true);
    // Track the opened record in the user's recently searched list.
    const userId = session?.user.id ?? null;
    const nextRecent = addRecentPerson(session, userId, person);
    setRecentPeople(nextRecent);
    try {
      setPersonRecord(await getPersonRecord(person.personId));
    } catch {
      setRecordError('The complete employee record could not be loaded.');
    } finally {
      setRecordLoading(false);
    }
  }

  async function openRecordByEmployeeNumber(employeeNumber: string) {
    const trimmed = employeeNumber.trim();
    if (!trimmed) return;
    setPositionDetails(null);
    setPositionError('');
    let person = people.find((candidate) => candidate.employeeNumber === trimmed);
    if (!person) {
      try {
        const result = await getPeople(trimmed, '', session);
        person = result.data.find((candidate) => candidate.employeeNumber === trimmed) ?? result.data[0] ?? null;
        if (!person) {
          setSelectedPerson({ personId: trimmed, employeeNumber: trimmed } as Person);
          setPersonRecord(null);
          setRecordError(`No employee record found for ${trimmed}.`);
          setRecordLoading(false);
          return;
        }
      } catch {
        setSelectedPerson({ personId: trimmed, employeeNumber: trimmed } as Person);
        setPersonRecord(null);
        setRecordError('The complete employee record could not be loaded.');
        setRecordLoading(false);
        return;
      }
    }
    await selectPerson(person);
  }

  async function openPositionByNumber(posNumber: string, organization: string) {
    const trimmed = posNumber.trim();
    if (!trimmed) return;
    setSelectedPerson(null);
    setPersonRecord(null);
    setRecordError('');
    setPositionDetails(null);
    setPositionError('');
    setPositionLoading(true);
    try {
      const details = await getPositionDetails(organization, trimmed);
      setPositionDetails(details);
      // Track the opened position in the user's recent-positions list.
      const userId = session?.user.id ?? null;
      const nextRecent = addRecentPosition(session, userId, {
        positionNumber: details.position.posNumber || trimmed,
        positionName: details.position.posName,
        organization: details.position.organization || organization,
        organizationId: '',
        fullName: details.incumbent?.fullName ?? '',
        employeeNumber: details.incumbent?.employeeNumber ?? '',
        vacant: details.vacant
      });
      setRecentPositions(nextRecent);
    } catch {
      setPositionError('The position details could not be loaded.');
    } finally {
      setPositionLoading(false);
    }
  }

  const drawerOpen = Boolean(selectedPerson || recordLoading || recordError || personRecord || positionDetails || positionLoading || positionError);
  function closeRecord() {
    setSelectedPerson(null);
    setPersonRecord(null);
    setRecordError('');
    setPositionDetails(null);
    setPositionLoading(false);
    setPositionError('');
    setPositionPinned(false);
    setPositionPinId(null);
  }

  useEffect(() => {
    if (!drawerOpen) return;
    function onKey(event: KeyboardEvent) { if (event.key === 'Escape') closeRecord(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  // Lock body scrolling while the employee/position drawer is open so the
  // page-level scrollbar disappears and the record is the person's focus.
  useEffect(() => {
    if (!drawerOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [drawerOpen]);

  function clearSearch() {
    setSearch('');
    setSchoolId('');
    setHasSearched(false);
    setResults([]);
    // Returning to no search shows the user's recent searches again.
    setRecentPeople(loadRecentPeople(session?.user.id ?? null));
    setRecentPositions(loadRecentPositions(session?.user.id ?? null));
  }

  // The directory landing list mirrors the recents. Derived rather than set at
  // every call site, so a reconcile that lands after the user has already
  // searched cannot replace their results with an older list.
  useEffect(() => {
    if (!hasSearched) setPeople(recentPeople);
  }, [recentPeople, hasSearched]);

  // Remove one person from the recent-searches list (only shown while the
  // directory is displaying recents, not live search results).
  function removeRecent(person: Person) {
    setRecentPeople(removeRecentPerson(session, session?.user.id ?? null, person.personId));
  }

  // Remove a recent person by id (the directory table holds DirectoryResult
  // rows, which only carry the id).
  function removeRecentPersonById(personId: string) {
    setRecentPeople(removeRecentPerson(session, session?.user.id ?? null, personId));
  }

  // Wipe the entire recent-searches list.
  function clearAllRecent() {
    setRecentPeople(clearRecentPeople(session, session?.user.id ?? null));
  }

  // Remove one position from the recent-positions list.
  function removeRecentPos(positionNumber: string, organization: string) {
    const next = removeRecentPosition(session, session?.user.id ?? null, positionNumber, organization);
    setRecentPositions(next);
  }

  // Wipe the entire recent-positions list.
  function clearAllRecentPositions() {
    setRecentPositions(clearRecentPositions(session, session?.user.id ?? null));
  }

  // Compute which system-wide announcements are visible for the current user.
  // Banners: active, not dismissed, newest first, capped at MAX_ACTIVE_BANNERS.
  const baseBannerKey = (message: SystemMessage) => bannerStorageKey(message.id, message.updatedAt);
  const visibleBanners = systemMessages
    .filter((message) => message.type === 'banner' && message.isActive && !dismissedMessages.has(baseBannerKey(message)))
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
    .slice(0, 3);
  const activeSplash = systemMessages.find((message) => message.type === 'splash' && message.isActive) ?? null;

  // The rows the directory table renders. While searching it is the unified
  // people+positions result set; on landing it is the recent people and
  // positions merged (people first), so both kinds of recents are reachable.
  const recentResults: DirectoryResult[] = [
    ...recentPeople.map((person): DirectoryResult => ({
      kind: 'person',
      personId: person.personId,
      employeeNumber: person.employeeNumber,
      fullName: person.fullName,
      email: person.email,
      organization: person.organization,
      organizationId: person.organizationId,
      positionName: person.positionName,
      positionNumber: '',
      vacant: false
    })),
    ...recentPositions.map((position): DirectoryResult => ({
      kind: 'position',
      positionNumber: position.positionNumber,
      positionName: position.positionName,
      organization: position.organization,
      organizationId: position.organizationId,
      personId: null,
      employeeNumber: position.employeeNumber,
      fullName: position.fullName,
      email: '',
      vacant: position.vacant
    }))
  ];
  const directoryRows = hasSearched ? results : recentResults;
  const directoryCount = directoryRows.length;

  function openDirectoryRow(row: DirectoryResult) {
    if (row.kind === 'person') {
      void selectPerson({
        personId: row.personId,
        employeeNumber: row.employeeNumber,
        firstName: '',
        lastName: '',
        fullName: row.fullName,
        email: row.email,
        organizationId: row.organizationId,
        organization: row.organization,
        positionName: row.positionName,
        costCenter: '',
        objectCode: '',
        activeAssignment: true
      } as Person);
    } else {
      void openPositionByNumber(row.positionNumber, row.organization);
    }
  }

  if (!session) {
    return <main className="login-shell">
      <section className="login-art" aria-hidden="true"><div className="login-art-mark"><img src="https://resources.finalsite.net/images/v1747849462/wcpssnet/hftgawk1qsknmcaafdky/wcpss_logos_rgbAsset141.svg" alt="" /></div><p className="eyebrow">Human Resources</p><h1>Reporting workspace</h1><p>Clearer records. Faster decisions.</p></section>
      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-panel-inner">
          <p className="eyebrow">Secure access</p><h2 id="login-title">Welcome back.</h2><p className="login-copy">Sign in with your Wake credentials to continue to HR Reporting.</p>
          <form className={`login-form${databaseUnavailable ? ' login-form--locked' : ''}`} onSubmit={submitLogin}>
            <label>Wake ID<input value={wakeId} onChange={(event) => setWakeId(event.target.value)} placeholder="your Wake ID" autoComplete="username" disabled={databaseUnavailable} required /></label>
            <label>Employee ID
              <span className="password-field">
                <input className="password-input" type={showEmployeeId ? 'text' : 'password'} value={employeeId} onChange={(event) => setEmployeeId(event.target.value)} placeholder="your employee ID" inputMode="numeric" autoComplete="off" disabled={databaseUnavailable} required />
                <button type="button" className="password-toggle" aria-label={showEmployeeId ? 'Hide Employee ID' : 'Show Employee ID'} aria-pressed={showEmployeeId} onClick={() => setShowEmployeeId((visible) => !visible)}>
                  {showEmployeeId ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </span>
            </label>
            <label className="remember-row"><input type="checkbox" checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} disabled={databaseUnavailable} /> Stay signed in on this device</label>
            {loginNotice && <div className="notice error" role="alert"><AlertCircle size={18} /><span>{loginNotice}</span></div>}
            <button className="primary-button login-button" disabled={loggingIn || databaseUnavailable}>{loggingIn ? 'Signing in...' : 'Sign in'}<ArrowUpRight size={17} /></button>
          </form>
          <p className="fixture-note">NOTE: This application is for WCPSS staff use only. Should you experience an error or have questions about the data, please contact the Help Desk at helpdesk@wcpss.net</p>
        </div>
      </section>
    </main>;
  }

  return (
    <main className="app-shell">
      {menuOpen && <button className="nav-scrim" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
      <aside className={`side-navigation ${menuOpen ? 'open' : ''}`} aria-label="Main navigation">
        <div className="side-navigation-heading"><strong>HR Reporting</strong><button className="icon-button" onClick={() => setMenuOpen(false)} aria-label="Close navigation" title="Close navigation"><X size={17} /></button></div>
        <nav><button className={activeView === 'home' ? 'nav-item active' : 'nav-item'} onClick={() => navigate('home')}><Home size={18} /><span>Home</span></button><button className={activeView === 'reports' ? 'nav-item active' : 'nav-item'} onClick={() => navigate('reports')}><BarChart3 size={18} /><span>Reports</span></button><button className={activeView === 'positions' ? 'nav-item active' : 'nav-item'} onClick={() => navigate('positions')}><Pin size={18} /><span>Positions</span>{positionPinsCount > 0 && <span className="nav-count">{positionPinsCount}</span>}</button>{advancedSearchEnabled && <button className={activeView === 'advanced-search' ? 'nav-item active' : 'nav-item'} onClick={() => navigate('advanced-search')}><SearchCheck size={18} /><span>Advanced Search</span></button>}{kpiEnabled && <button className={activeView === 'kpi' || activeView === 'kpi-drilldown' || activeView === 'kpi-definition' ? 'nav-item active' : 'nav-item'} onClick={() => navigate('kpi')}><Gauge size={18} /><span>KPI Dashboard</span></button>}{isDataTeam && futureEnabled && <button className={activeView === 'future-positions' ? 'nav-item active' : 'nav-item'} onClick={() => navigate('future-positions')}><ClipboardCheck size={18} /><span>Future Positions (Beta)</span></button>}{isAdmin && <button className={activeView === 'settings' ? 'nav-item active' : 'nav-item'} onClick={() => navigate('settings')}><SlidersHorizontal size={18} /><span>Report Configuration</span></button>}{isAdmin && <button className={activeView === 'features' ? 'nav-item active' : 'nav-item'} onClick={() => navigate('features')}><Flag size={18} /><span>Features</span></button>}{aiEnabled && <button className={activeView === 'ai' ? 'nav-item active' : 'nav-item'} onClick={() => navigate('ai')}><MessageSquare size={18} /><span>AI Assistant (Development Only)</span></button>}</nav>
      </aside>
      <header className="topbar">
        <button className="icon-button menu-trigger" onClick={() => setMenuOpen(true)} aria-label="Open navigation" title="Open navigation"><Menu size={21} /></button>
        <div className="brand-lockup">
          <div>
            <p className="eyebrow">Human Resources</p>
            <h1>Reporting workspace</h1>
          </div>
        </div>
        <div className="topbar-meta">
          <div className="welcome-block"><strong>Welcome, {session.person.firstName}</strong><span>{session.person.positionName}, {session.school.name}</span></div>
          <button className="icon-button subtle settings-toggle" onClick={() => setUserSettingsOpen((open) => !open)} aria-label="Open settings" title="Settings" aria-expanded={userSettingsOpen}>
            <Settings2 size={18} />
          </button>
          <button className="icon-button subtle theme-toggle" onClick={() => setTheme((current) => current === 'light' ? 'dark' : 'light')} aria-label="Toggle light or dark mode" title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}>
            {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
          </button>
          <button className="icon-button subtle logout-button" onClick={signOut} aria-label="Sign out" title="Sign out"><LogOut size={18} /></button>
        </div>
      </header>

      {systemMessagesEnabled && visibleBanners.length > 0 && (
        <div className="system-banners" role="region" aria-label="Announcements">
          {visibleBanners.map((message) => (
            <div key={message.id} className="system-banner">
              <div className="system-banner-content">
                {message.title && <strong className="system-banner-title">{message.title}</strong>}
                <SystemMessageBody className="system-banner-body" text={message.message} />
              </div>
              <button className="system-banner-dismiss" onClick={() => dismissBanner(message)} aria-label="Dismiss announcement" title="Dismiss">
                <X size={16} />
              </button>
            </div>
          ))}
        </div>
      )}

      {activeView === 'reports' ? <ReportsPage schools={schools} session={session} onManage={isAdmin ? () => navigate('settings') : undefined} onOpenRecord={openRecordByEmployeeNumber} onOpenPosition={openPositionByNumber} /> : activeView === 'kpi' ? <KpiDashboardPage session={session} schools={schools} schoolId={kpiSchoolId} onSchoolChange={setKpiSchoolId} pendingRequest={kpiPendingRequest} onPendingHandled={() => setKpiPendingRequest(null)} onDrill={openKpiList} onDefine={openKpiDefinition} /> : activeView === 'kpi-drilldown' ? (kpiTarget ? <KpiDrilldownPage session={session} target={kpiTarget} onBack={() => navigate('kpi')} onDefine={openKpiDefinition} onOpenPosition={openPositionByNumber} onOpenRecord={openRecordByEmployeeNumber} /> : <section className="reports-page"><div className="empty-state"><AlertCircle size={26} /><p>Pick a tile or a bar on the KPI dashboard to open a list.</p></div><button className="back-button" onClick={() => navigate('kpi')}><ArrowUpRight size={17} />KPI dashboard</button></section>) : activeView === 'kpi-definition' ? <KpiDefinitionPage metric={kpiDefinitionMetric} onBack={() => navigate('kpi')} onChooseMetric={setKpiDefinitionMetric} onDrill={openKpiListFromDefinition} /> : activeView === 'positions' ? <PositionsPage session={session} schools={schools} onOpenPosition={openPositionByNumber} /> : activeView === 'advanced-search' ? <AdvancedSearchPage session={session} schools={schools} onOpenPosition={openPositionByNumber} /> : activeView === 'future-positions' ? (isDataTeam && futureEnabled && session ? <FuturePositionsPage session={session} onOpenPosition={openPositionByNumber} /> : <section className="reports-page"><div className="notice error"><AlertCircle size={18} /><span>{isDataTeam ? 'Future Positions is disabled. An administrator can turn it back on from Features.' : 'Access denied. Data team access is required.'}</span></div></section>) : activeView === 'settings' ? (isAdmin && session ? <SettingsPage session={session} schools={schools} onFlagsChanged={applyFlags} /> : <section className="reports-page"><div className="notice error"><AlertCircle size={18} /><span>Access denied. Admin access is required.</span></div></section>) : activeView === 'ai' ? (aiEnabled && session ? <AiAssistantPage session={session} /> : <section className="reports-page"><div className="notice error"><AlertCircle size={18} /><span>Access denied. The AI Assistant is disabled.</span></div></section>) : activeView === 'style-config' ? (styleConfigEnabled && session ? <StyleConfigurationPage session={session} /> : <section className="reports-page"><div className="notice error"><AlertCircle size={18} /><span>Access denied. Style Configuration is disabled.</span></div></section>) : activeView === 'features' ? (isAdmin && session ? <FeaturesPage session={session} onFlagsChanged={applyFlags} onManageSystemMessages={() => navigate('system-messages')} onManageSystemInfo={() => navigate('system-info')} onManageStyleConfig={() => navigate('style-config')} /> : <section className="reports-page"><div className="notice error"><AlertCircle size={18} /><span>Access denied. Admin access is required.</span></div></section>) : activeView === 'system-messages' ? (isAdmin && systemMessagesEnabled && session ? <SystemMessagesPage session={session} onBack={() => navigate('features')} /> : <section className="reports-page"><div className="notice error"><AlertCircle size={18} /><span>{isAdmin ? 'System-wide messages are disabled. An administrator can turn them back on from Features.' : 'Access denied. Admin access is required.'}</span></div></section>) : activeView === 'system-info' ? (isAdmin && systemInfoEnabled && session ? <SystemInfoPage session={session} /> : <section className="reports-page"><div className="notice error"><AlertCircle size={18} /><span>{isAdmin ? 'System Information is disabled. An administrator can turn it back on from Features.' : 'Access denied. Admin access is required.'}</span></div></section>) : <>
      <section className="hero-band">
        <div>
          <p className="eyebrow">People directory</p>
          <h2>Find the right record quickly.</h2>
          <p className="hero-copy">Search employee records by name, employee number, position number, or organization.</p>
        </div>
        <div className="hero-stat"><Users size={18} /><strong>{directoryCount}</strong><span>{hasSearched ? 'results' : 'recently searched'}</span></div>
      </section>

      <section className="workspace-grid" aria-label="People lookup">
        <div className="directory-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Directory</p>
              <h3>People lookup</h3>
            </div>
            <div className="panel-heading-actions">
              <span className="result-count">{directoryCount} {hasSearched ? 'results' : 'recent'}</span>
              {!hasSearched && directoryCount > 0 && <button type="button" className="link-button" onClick={() => { clearAllRecent(); clearAllRecentPositions(); }}>Clear all</button>}
            </div>
          </div>

          <div className="search-row">
            <label className="search-field">
              <Search size={18} aria-hidden="true" />
              <span className="sr-only">Search people and positions</span>
              <input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void runSearch(); }} placeholder="Name, employee no., position no., or organization" />
              {search && <button className="field-clear" onClick={clearSearch} aria-label="Clear search" title="Clear search"><X size={15} /></button>}
            </label>
            <SchoolCombobox
              schools={schools}
              value={schoolId}
              onChange={(id) => setSchoolId(id)}
              emptyLabel={session.user.canViewAllSchools ? 'All schools and departments' : 'Select a school…'}
              ariaLabel="Filter by school"
              allowEmpty={session.user.canViewAllSchools}
              leadingIcon={<Building2 size={17} aria-hidden="true" />}
            />
            <button className="primary-button" onClick={() => void runSearch()}><Search size={17} />Search</button>
          </div>

          {error && <div className="notice error"><AlertCircle size={18} /><span>{error}</span></div>}
          {loading ? <div className="empty-state"><span className="loader" />Loading directory</div> : directoryRows.length === 0 ? <div className="empty-state">{hasSearched ? 'No people or positions match the current filters.' : 'No recent searches.'}</div> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Person</th><th>Organization</th><th>Position</th><th>Employee no.</th><th><span className="sr-only">Open</span></th>{!hasSearched && <th className="recent-actions-col"><span className="sr-only">Remove</span></th>}</tr></thead>
                <tbody>{directoryRows.map((row) => {
                  const key = row.kind === 'person' ? `person:${row.personId}` : `position:${row.positionNumber}:${row.organization}`;
                  const selected = row.kind === 'person' && selectedPerson?.personId === row.personId;
                  return <tr key={key} className={selected ? 'selected' : ''} onClick={() => openDirectoryRow(row)}>
                    <td>
                      {row.kind === 'position' && row.vacant
                        ? <span className="badge-vacant">Vacant</span>
                        : <><strong>{row.fullName}</strong>{row.email && <span>{row.email}</span>}</>}
                    </td>
                    <td>{row.organization}</td>
                    <td>{row.positionName}</td>
                    <td className="mono">{row.kind === 'position' && row.vacant ? '—' : row.employeeNumber}</td>
                    <td><ArrowUpRight size={17} aria-hidden="true" /></td>
                    {!hasSearched && <td className="recent-actions-col">
                      <button type="button" className="field-clear" aria-label={`Remove ${row.kind === 'person' ? row.fullName : row.positionName} from recent searches`} title="Remove from recent searches" onClick={(event) => { event.stopPropagation(); if (row.kind === 'person') removeRecentPersonById(row.personId); else removeRecentPos(row.positionNumber, row.organization); }}><X size={15} /></button>
                    </td>}
                  </tr>;
                })}</tbody>
              </table>
            </div>
          )}
        </div>
      </section>
      </>}
      {drawerOpen && <>
        <button className="record-drawer-scrim" aria-label="Close drawer" onClick={closeRecord} />
        <aside className="record-drawer" role="dialog" aria-modal="true" aria-label={positionDetails || positionLoading || positionError ? 'Position details' : 'Employee record'}>
          {positionLoading ? <div className="empty-state"><span className="loader" />Loading position details</div> : positionError ? <div className="empty-state"><AlertCircle size={26} /><p>{positionError}</p></div> : positionDetails ? (
            <PositionDetailView details={positionDetails} onClose={closeRecord} onOpenRecord={openRecordByEmployeeNumber} pinned={positionPinned} onTogglePin={() => void togglePositionPin()} session={session} futureEnabled={futureEnabled} />
          ) : recordLoading ? <div className="empty-state"><span className="loader" />Loading employee record</div> : recordError ? <div className="empty-state"><AlertCircle size={26} /><p>{recordError}</p></div> : personRecord ? <>
            {layoutNotice && <div className="notice success" role="status" aria-live="polite">{layoutNotice}</div>}
            <div aria-live="polite" className="sr-only">{layoutNotice}</div>
            <EmployeeRecord record={personRecord} layout={recordLayout} userId={session?.user.id ?? null} onClose={closeRecord} onReorder={reorderRecordSection} onMoveUp={moveRecordSectionUp} onMoveDown={moveRecordSectionDown} onToggleVisibility={toggleSectionVisibility} onOpenPosition={openPositionByNumber} theme={theme} layoutHint={hiddenLayoutCount > 0 ? `${hiddenLayoutCount} section${hiddenLayoutCount === 1 ? '' : 's'} hidden` : 'Drag sections to reorder'} canShowAll={hiddenLayoutCount > 0} onShowAllSections={showAllSectionsNow} onResetLayout={resetRecordLayoutState} onSaveLayout={saveRecordLayoutState} isLayoutDirty={isLayoutDirty} />
          </> : <div className="detail-placeholder"><Users size={28} /><h3>Select a person</h3><p>Choose a record from the directory to inspect the complete employee report.</p></div>}
        </aside>
      </>}
      {userSettingsOpen && <>
        <button className="record-drawer-scrim" aria-label="Close settings" onClick={() => setUserSettingsOpen(false)} />
        <UserSettingsPage homePage={homePage} onChangeHomePage={changeHomePage} onClose={() => setUserSettingsOpen(false)} session={session} isAdmin={isAdmin} />
      </>}
      {activeSplash && !splashSeen && (
        <div className="system-splash-scrim" role="dialog" aria-modal="true" aria-label={activeSplash.title || 'Announcement'}>
          <div className="system-splash">
            <div className="system-splash-heading">
              {activeSplash.title && <h2>{activeSplash.title}</h2>}
              <button className="system-splash-close" onClick={() => setSplashSeen(true)} aria-label="Close announcement" title="Close"><X size={18} /></button>
            </div>
            <SystemMessageBody className="system-splash-body" text={activeSplash.message} plainTag="p" />
            <button className="primary-button" onClick={() => setSplashSeen(true)}>Got it</button>
          </div>
        </div>
      )}
    </main>
  );
}
