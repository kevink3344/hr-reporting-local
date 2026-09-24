import { useEffect, useState } from 'react';
import { AlertCircle, ArrowLeft, CheckCircle2, ListChecks, Send } from 'lucide-react';
import type { LoginSession, SystemMessage, SystemMessageType } from './types';
import {
  getSystemMessagesAll,
  createSystemMessage,
  updateSystemMessage,
  deleteSystemMessage,
} from './api';
import { systemMessageToPlainText } from './systemMessageFormat';

// Maximum simultaneous active banners. Enforced client-side (and the server
// keeps banner counts per-type; a friendly validation is enough here).
const MAX_ACTIVE_BANNERS = 3;

// Admin-only manager for the system-wide Splash / Banner announcements.
//
// Split out of the Settings drawer into its own page so the composer and the
// published list have room to breathe. It is deliberately NOT a navigation
// item: admins reach it from the Features page, which owns the
// `system_messages` flag that gates this whole feature.
export function SystemMessagesPage({ session, onBack }: { session: LoginSession; onBack: () => void }) {
  const [messages, setMessages] = useState<SystemMessage[]>([]);
  const [messagesError, setMessagesError] = useState('');
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [notice, setNotice] = useState('');

  // Draft fields for the compose form.
  const [draftTitle, setDraftTitle] = useState('');
  const [draftMessage, setDraftMessage] = useState('');
  const [draftType, setDraftType] = useState<SystemMessageType>('banner');
  const [draftActive, setDraftActive] = useState(true);
  const [draftError, setDraftError] = useState('');

  // Id of the message currently being edited, or null when adding.
  const [editingId, setEditingId] = useState<string | null>(null);

  async function refreshMessages() {
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
    void refreshMessages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.user.id]);

  function resetDraft() {
    setDraftTitle('');
    setDraftMessage('');
    setDraftType('banner');
    setDraftActive(true);
    setDraftError('');
    setEditingId(null);
  }

  async function handleSave() {
    const message = draftMessage.trim();
    if (!message) {
      setDraftError('Message is required.');
      return;
    }
    const activeBanners = messages.filter((item) => item.isActive && item.type === 'banner');
    if (!editingId && draftType === 'banner' && draftActive && activeBanners.length >= MAX_ACTIVE_BANNERS) {
      setDraftError(`Only ${MAX_ACTIVE_BANNERS} active banners are allowed at a time.`);
      return;
    }
    setDraftError('');
    setNotice('');
    try {
      const title = draftTitle.trim();
      const payload = { title, message, type: draftType, isActive: draftActive };
      if (editingId) {
        await updateSystemMessage(session, editingId, payload);
        setNotice('Message updated.');
      } else {
        await createSystemMessage(session, payload);
        setNotice(draftActive ? `New ${draftType} published.` : `New ${draftType} saved as inactive.`);
      }
      resetDraft();
      await refreshMessages();
    } catch (error) {
      setDraftError(error instanceof Error ? error.message : 'Save failed.');
    }
  }

  async function handleToggleActive(message: SystemMessage) {
    setNotice('');
    try {
      const updated = await updateSystemMessage(session, message.id, { isActive: !message.isActive });
      setNotice(`Message is now ${updated.isActive ? 'active' : 'inactive'}.`);
      await refreshMessages();
    } catch (error) {
      setMessagesError(error instanceof Error ? error.message : 'Update failed.');
    }
  }

  async function handleDelete(message: SystemMessage) {
    if (!window.confirm(`Delete this ${message.type} message?`)) return;
    setNotice('');
    try {
      await deleteSystemMessage(session, message.id);
      if (editingId === message.id) resetDraft();
      setNotice('Message deleted.');
      await refreshMessages();
    } catch (error) {
      setMessagesError(error instanceof Error ? error.message : 'Delete failed.');
    }
  }

  function startEdit(message: SystemMessage) {
    setEditingId(message.id);
    setDraftTitle(message.title);
    // A legacy rich-text body is flattened to its plain text, so the textarea
    // shows the announcement instead of a Quill Delta document. Saving then
    // stores plain text, which is the format this feature is specified in.
    setDraftMessage(systemMessageToPlainText(message.message));
    setDraftType(message.type);
    setDraftActive(message.isActive);
    setDraftError('');
    setNotice('');
  }

  const activeBannerCount = messages.filter((message) => message.isActive && message.type === 'banner').length;
  const activeSplash = messages.find((message) => message.isActive && message.type === 'splash') ?? null;

  return (
    <section className="reports-page" aria-labelledby="system-messages-title">
      <div className="reports-page-heading">
        <div>
          <p className="eyebrow">Admin</p>
          <h2 id="system-messages-title">System-wide messages.</h2>
          <p className="reports-intro">Publish an announcement everyone sees. A <strong>Banner</strong> shows as a full-width strip directly under the header on every page until each person dismisses it; a <strong>Splash</strong> takes over the screen once, right after sign-in.</p>
        </div>
        <button type="button" className="back-button" onClick={onBack}><ArrowLeft size={17} />Features</button>
      </div>

      {notice && <div className="notice success"><CheckCircle2 size={18} /><span>{notice}</span></div>}
      {messagesError && <div className="notice error"><AlertCircle size={18} /><span>{messagesError}</span></div>}

      <div className="messages-page-grid">
        <div className="feature-group">
          <h3 className="settings-section-title"><Send size={16} />Compose</h3>
          <div className="settings-panel">
            <div className="settings-form-row">
              <div className="settings-field">
                <span className="settings-label">Type</span>
                <div className="segmented-control" role="radiogroup" aria-label="Message type">
                  <button type="button" role="radio" aria-checked={draftType === 'banner'} className={draftType === 'banner' ? 'active' : ''} onClick={() => setDraftType('banner')}>Banner</button>
                  <button type="button" role="radio" aria-checked={draftType === 'splash'} className={draftType === 'splash' ? 'active' : ''} onClick={() => setDraftType('splash')}>Splash</button>
                </div>
              </div>
            </div>
            <p className="settings-hint" style={{ margin: 0 }}>
              {draftType === 'banner'
                ? `Stacks under the header on every page. ${activeBannerCount} of ${MAX_ACTIVE_BANNERS} banners active.`
                : activeSplash
                  ? 'A splash takes over the screen once, right after sign-in. Only the most recent active splash is shown.'
                  : 'A splash takes over the screen once, right after sign-in.'}
            </p>
            <div className="settings-form-row">
              <div className="settings-field">
                <span className="settings-label">Title {editingId ? '(edit)' : ''}</span>
                <input className="text-input" value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} placeholder="Short heading (optional)" maxLength={200} />
              </div>
            </div>
            <div className="settings-form-row">
              <div className="settings-field">
                <span className="settings-label">Message</span>
                <textarea className="text-area" value={draftMessage} onChange={(e) => setDraftMessage(e.target.value)} placeholder="Announcement text" rows={5} maxLength={2000} />
              </div>
            </div>
            {/* Same switch as the rows below so "Active" looks identical
                wherever it appears: publish now, or save as a draft. */}
            <div className="system-message-toggle compose-active-toggle">
              <button
                type="button"
                role="switch"
                aria-checked={draftActive}
                aria-label="Publish as active"
                className={draftActive ? 'switch switch-on' : 'switch'}
                onClick={() => setDraftActive(!draftActive)}
              >
                <span className="switch-knob" />
              </button>
              <span className="system-message-toggle-text">
                Active
                <span className="system-message-toggle-label">{draftActive ? 'On' : 'Off'}</span>
              </span>
            </div>
            {draftError && <p className="settings-error">{draftError}</p>}
            <div className="settings-inline-actions">
              <button type="button" className="primary-button" onClick={handleSave}>{editingId ? 'Save changes' : 'Add message'}</button>
              {editingId && <button type="button" className="ghost-button" onClick={resetDraft}>Cancel</button>}
            </div>
          </div>
        </div>

        <div className="feature-group">
          <div className="settings-section-heading">
            <h3 className="settings-section-title"><ListChecks size={16} />Published{messages.length > 0 ? ` (${messages.length})` : ''}</h3>
            <button type="button" className="icon-button subtle" onClick={() => void refreshMessages()} aria-label="Refresh messages" title="Refresh"><span aria-hidden="true">⟳</span></button>
          </div>
          <div className="system-messages-list">
            {loadingMessages && <p className="settings-hint">Loading…</p>}
            {!loadingMessages && messages.length === 0 && <p className="settings-hint">No messages yet.</p>}
            {messages.map((message) => (
              <div key={message.id} className={`system-message-item ${message.isActive ? '' : 'inactive'}`}>
                <div className="system-message-item-main col">
                  <span className="system-message-item-title">
                    <span className={`system-message-type-badge ${message.type}`}>{message.type}</span>
                    {message.title || '(untitled)'}
                  </span>
                  <span className="system-message-item-body">{systemMessageToPlainText(message.message)}</span>
                </div>
                {/* Edit reads as a normal button, and the state is a switch that
                    says On/Off out loud — the old ✎ / ◌ pair made an admin guess
                    which glyph meant "active" and which row was being edited. */}
                <div className="system-message-item-actions">
                  <button
                    type="button"
                    className={editingId === message.id ? 'message-action-button is-editing' : 'message-action-button'}
                    aria-pressed={editingId === message.id}
                    onClick={() => startEdit(message)}
                  >
                    {editingId === message.id ? 'Editing' : 'Edit'}
                  </button>
                  <span className="system-message-toggle">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={message.isActive}
                      aria-label={`${message.title || 'Announcement'} active`}
                      title={message.isActive ? 'Deactivate' : 'Activate'}
                      className={message.isActive ? 'switch switch-on' : 'switch'}
                      onClick={() => void handleToggleActive(message)}
                    >
                      <span className="switch-knob" />
                    </button>
                    <span className="system-message-toggle-label">{message.isActive ? 'On' : 'Off'}</span>
                  </span>
                  <button type="button" className="icon-button subtle danger" onClick={() => void handleDelete(message)} aria-label="Delete message" title="Delete"><span aria-hidden="true">🗑</span></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
