import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { HomePage } from './homePage';
import type { LoginSession, SystemMessage, SystemMessageType } from './types';
import {
  getSystemMessagesAll,
  createSystemMessage,
  updateSystemMessage,
  deleteSystemMessage,
} from './api';

const HOME_PAGE_OPTIONS: { value: HomePage; label: string }[] = [
  { value: 'home', label: 'Home' },
  { value: 'reports', label: 'Reports' },
  { value: 'positions', label: 'Positions' },
];

// Maximum simultaneous active banners. Enforced client-side (and the server
// keeps banner counts per-type; a friendly validation is enough here).
const MAX_ACTIVE_BANNERS = 3;

// User-facing settings drawer (opened from the topbar gear icon). Holds the
// per-user configurable options such as the default home page, plus (for
// admins only) the system-wide message manager for Splash / Banner messages.
export function UserSettingsPage({
  homePage,
  onChangeHomePage,
  onClose,
  session,
  isAdmin,
}: {
  homePage: HomePage;
  onChangeHomePage: (page: HomePage) => void;
  onClose: () => void;
  session: LoginSession | null;
  isAdmin: boolean;
}) {
  const activeIndex = Math.max(0, HOME_PAGE_OPTIONS.findIndex((option) => option.value === homePage));
  const [messages, setMessages] = useState<SystemMessage[]>([]);
  const [messagesError, setMessagesError] = useState('');
  const [loadingMessages, setLoadingMessages] = useState(false);

  // Draft fields for the add form.
  const [draftTitle, setDraftTitle] = useState('');
  const [draftMessage, setDraftMessage] = useState('');
  const [draftType, setDraftType] = useState<SystemMessageType>('banner');
  const [draftActive, setDraftActive] = useState(true);
  const [draftError, setDraftError] = useState('');

  // Id of the message currently being edited, or null when adding.
  const [editingId, setEditingId] = useState<string | null>(null);

  async function refreshMessages() {
    if (!session || !isAdmin) return;
    setLoadingMessages(true);
    setMessagesError('');
    try {
      const list = await getSystemMessagesAll(session);
      setMessages(list);
    } catch (error) {
      setMessagesError(error instanceof Error ? error.message : 'Failed to load messages');
    } finally {
      setLoadingMessages(false);
    }
  }

  useEffect(() => {
    if (isAdmin) void refreshMessages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, session?.user?.id]);

  function resetDraft() {
    setDraftTitle('');
    setDraftMessage('');
    setDraftType('banner');
    setDraftActive(true);
    setDraftError('');
    setEditingId(null);
  }

  async function handleSave() {
    if (!session) return;
    const message = draftMessage.trim();
    if (!message) {
      setDraftError('Message is required.');
      return;
    }
    const activeBanners = messages.filter((m) => m.isActive && m.type === 'banner');
    if (!editingId && draftType === 'banner' && draftActive && activeBanners.length >= MAX_ACTIVE_BANNERS) {
      setDraftError(`Only ${MAX_ACTIVE_BANNERS} active banners are allowed at a time.`);
      return;
    }
    setDraftError('');
    try {
      const title = draftTitle.trim();
      const payload = { title, message, type: draftType, isActive: draftActive };
      if (editingId) {
        await updateSystemMessage(session, editingId, payload);
      } else {
        await createSystemMessage(session, payload);
      }
      resetDraft();
      await refreshMessages();
    } catch (error) {
      setDraftError(error instanceof Error ? error.message : 'Save failed.');
    }
  }

  async function handleToggleActive(message: SystemMessage) {
    if (!session) return;
    try {
      await updateSystemMessage(session, message.id, { isActive: !message.isActive });
      await refreshMessages();
    } catch (error) {
      setMessagesError(error instanceof Error ? error.message : 'Update failed.');
    }
  }

  async function handleDelete(message: SystemMessage) {
    if (!session) return;
    if (!window.confirm(`Delete this ${message.type} message?`)) return;
    try {
      await deleteSystemMessage(session, message.id);
      if (editingId === message.id) resetDraft();
      await refreshMessages();
    } catch (error) {
      setMessagesError(error instanceof Error ? error.message : 'Delete failed.');
    }
  }

  function startEdit(message: SystemMessage) {
    setEditingId(message.id);
    setDraftTitle(message.title);
    setDraftMessage(message.message);
    setDraftType(message.type);
    setDraftActive(message.isActive);
    setDraftError('');
  }

  return <div className="record-drawer" role="dialog" aria-modal="true" aria-label="Settings">
    <div className="record-title">
      <div>
        <p className="eyebrow">Preferences</p>
        <h3>Settings</h3>
      </div>
      <div className="record-title-actions"><button className="icon-button" onClick={onClose} aria-label="Close settings" title="Close settings"><X size={17} /></button></div>
    </div>
    <div className="settings-panel">
      <div className="settings-form-row">
        <div className="settings-field">
          <span className="settings-label">Default home page</span>
          <div className="home-page-slider" role="radiogroup" aria-label="Default home page">
            <span className="home-page-slider-thumb" style={{ transform: `translateX(${activeIndex * 100}%)` }} aria-hidden="true" />
            {HOME_PAGE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={homePage === option.value}
                className={`home-page-slider-option ${homePage === option.value ? 'active' : ''}`}
                onClick={() => onChangeHomePage(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <p className="settings-hint">Choose the page you land on after signing in.</p>

      {isAdmin && (
        <div className="settings-section system-messages-admin">
          <div className="settings-section-heading">
            <h4>System-wide messages</h4>
            <button type="button" className="icon-button subtle" onClick={refreshMessages} aria-label="Refresh messages" title="Refresh"><span aria-hidden="true">⟳</span></button>
          </div>
          {messagesError && <p className="settings-error">{messagesError}</p>}

          <div className="settings-form-row">
            <div className="settings-field">
              <span className="settings-label">Type</span>
              <div className="segmented-control" role="radiogroup" aria-label="Message type">
                <button type="button" role="radio" aria-checked={draftType === 'banner'} className={draftType === 'banner' ? 'active' : ''} onClick={() => setDraftType('banner')}>Banner</button>
                <button type="button" role="radio" aria-checked={draftType === 'splash'} className={draftType === 'splash' ? 'active' : ''} onClick={() => setDraftType('splash')}>Splash</button>
              </div>
            </div>
          </div>
          <div className="settings-form-row">
            <div className="settings-field">
              <span className="settings-label">Title {editingId ? '(edit)' : ''}</span>
              <input className="text-input" value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} placeholder="Short heading (optional)" maxLength={200} />
            </div>
          </div>
          <div className="settings-form-row">
            <div className="settings-field">
              <span className="settings-label">Message</span>
              <textarea className="text-area" value={draftMessage} onChange={(e) => setDraftMessage(e.target.value)} placeholder="Announcement text" rows={3} maxLength={2000} />
            </div>
          </div>
          <label className="settings-checkbox">
            <input type="checkbox" checked={draftActive} onChange={(e) => setDraftActive(e.target.checked)} />
            <span>Active</span>
          </label>
          {draftError && <p className="settings-error">{draftError}</p>}
          <div className="settings-inline-actions">
            <button type="button" className="primary-button" onClick={handleSave}>{editingId ? 'Save changes' : 'Add message'}</button>
            {editingId && <button type="button" className="ghost-button" onClick={resetDraft}>Cancel</button>}
          </div>

          <div className="system-messages-list">
            {loadingMessages && <p className="settings-hint">Loading…</p>}
            {!loadingMessages && messages.length === 0 && <p className="settings-hint">No messages yet.</p>}
            {messages.map((message) => (
              <div key={message.id} className={`system-message-item ${message.isActive ? '' : 'inactive'}`}>
                <div className="system-message-item-main">
                  <span className={`system-message-type-badge ${message.type}`}>{message.type}</span>
                  <span className="system-message-item-title">{message.title || '(untitled)'}</span>
                  <span className="system-message-item-status">{message.isActive ? 'active' : 'inactive'}</span>
                </div>
                <div className="system-message-item-actions">
                  <button type="button" className="icon-button subtle" onClick={() => startEdit(message)} aria-label="Edit message" title="Edit"><span aria-hidden="true">✎</span></button>
                  <button type="button" className="icon-button subtle" onClick={() => handleToggleActive(message)} aria-label={message.isActive ? 'Deactivate' : 'Activate'} title={message.isActive ? 'Deactivate' : 'Activate'}><span aria-hidden="true">{message.isActive ? '◌' : '●'}</span></button>
                  <button type="button" className="icon-button subtle danger" onClick={() => handleDelete(message)} aria-label="Delete message" title="Delete"><span aria-hidden="true">🗑</span></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  </div>;
}
