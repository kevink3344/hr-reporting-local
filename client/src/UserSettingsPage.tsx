import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { HomePage } from './homePage';
import type { LoginSession, SystemMessage, SystemMessageType, SystemUser, SystemUserInput } from './types';
import {
  getSystemMessagesAll,
  createSystemMessage,
  updateSystemMessage,
  deleteSystemMessage,
  getUsers,
  createUser,
  updateUser,
  deleteUser,
} from './api';

const HOME_PAGE_OPTIONS: { value: HomePage; label: string }[] = [
  { value: 'home', label: 'Home' },
  { value: 'reports', label: 'Reports' },
  { value: 'positions', label: 'Positions' },
];

// Maximum simultaneous active banners. Enforced client-side (and the server
// keeps banner counts per-type; a friendly validation is enough here).
const MAX_ACTIVE_BANNERS = 3;

function emptyUserInput(): SystemUserInput {
  return {
    username: '',
    wakeId: '',
    employeeNumber: '',
    displayName: '',
    email: '',
    roles: [],
    schoolIds: [],
    canViewAllSchools: false
  };
}

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

  // ---- Users (admin) ----
  const [users, setUsers] = useState<SystemUser[]>([]);
  const [usersError, setUsersError] = useState('');
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [userDraft, setUserDraft] = useState<SystemUserInput>(emptyUserInput());
  // Comma-separated editor strings; split into arrays on save.
  const [userRolesText, setUserRolesText] = useState('');
  const [userSchoolIdsText, setUserSchoolIdsText] = useState('');
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [userDraftError, setUserDraftError] = useState('');

  async function refreshUsers() {
    if (!session || !isAdmin) return;
    setLoadingUsers(true);
    setUsersError('');
    try {
      const list = await getUsers(session);
      setUsers(list);
    } catch (error) {
      setUsersError(error instanceof Error ? error.message : 'Failed to load users');
    } finally {
      setLoadingUsers(false);
    }
  }

  useEffect(() => {
    if (isAdmin) void refreshUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, session?.user?.id]);

  function resetUserDraft() {
    setUserDraft(emptyUserInput());
    setUserRolesText('');
    setUserSchoolIdsText('');
    setUserDraftError('');
    setEditingUserId(null);
  }

  function startEditUser(user: SystemUser) {
    setEditingUserId(user.id);
    setUserDraft({
      username: user.username,
      wakeId: user.wakeId,
      employeeNumber: user.employeeNumber,
      displayName: user.displayName,
      email: user.email ?? '',
      roles: user.roles,
      schoolIds: user.schoolIds,
      canViewAllSchools: user.canViewAllSchools
    });
    setUserRolesText(user.roles.join(', '));
    setUserSchoolIdsText(user.schoolIds.join(', '));
    setUserDraftError('');
  }

  function parseCsv(value: string): string[] {
    return value.split(',').map((part) => part.trim()).filter(Boolean);
  }

  async function handleSaveUser() {
    if (!session) return;
    const input: SystemUserInput = {
      username: userDraft.username?.trim() ?? '',
      wakeId: userDraft.wakeId?.trim() ?? '',
      employeeNumber: userDraft.employeeNumber?.trim() ?? '',
      displayName: userDraft.displayName?.trim() ?? '',
      email: userDraft.email?.trim() ?? '',
      roles: parseCsv(userRolesText),
      schoolIds: parseCsv(userSchoolIdsText),
      canViewAllSchools: userDraft.canViewAllSchools ?? false
    };
    if (!input.username || !input.wakeId || !input.employeeNumber || !input.displayName) {
      setUserDraftError('Username, Wake ID, employee number, and display name are required.');
      return;
    }
    setUserDraftError('');
    try {
      if (editingUserId) {
        await updateUser(session, editingUserId, input);
      } else {
        await createUser(session, input);
      }
      resetUserDraft();
      await refreshUsers();
    } catch (error) {
      setUserDraftError(error instanceof Error ? error.message : 'Save failed.');
    }
  }

  async function handleDeleteUser(user: SystemUser) {
    if (!session) return;
    if (!window.confirm(`Delete user "${user.displayName}" (${user.username})?`)) return;
    try {
      await deleteUser(session, user.id);
      if (editingUserId === user.id) resetUserDraft();
      await refreshUsers();
    } catch (error) {
      setUsersError(error instanceof Error ? error.message : 'Delete failed.');
    }
  }

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

      {isAdmin && (
        <div className="settings-section users-admin">
          <div className="settings-section-heading">
            <h4>Users</h4>
            <button type="button" className="icon-button subtle" onClick={refreshUsers} aria-label="Refresh users" title="Refresh"><span aria-hidden="true">⟳</span></button>
          </div>
          {usersError && <p className="settings-error">{usersError}</p>}

          <div className="settings-form-row">
            <div className="settings-field">
              <span className="settings-label">Username</span>
              <input className="text-input" value={userDraft.username ?? ''} onChange={(e) => setUserDraft({ ...userDraft, username: e.target.value })} placeholder="e.g. hr.admin" maxLength={64} />
            </div>
          </div>
          <div className="settings-form-row">
            <div className="settings-field">
              <span className="settings-label">Wake ID</span>
              <input className="text-input" value={userDraft.wakeId ?? ''} onChange={(e) => setUserDraft({ ...userDraft, wakeId: e.target.value })} placeholder="e.g. W000001" maxLength={128} />
            </div>
          </div>
          <div className="settings-form-row">
            <div className="settings-field">
              <span className="settings-label">Employee number</span>
              <input className="text-input" value={userDraft.employeeNumber ?? ''} onChange={(e) => setUserDraft({ ...userDraft, employeeNumber: e.target.value })} placeholder="e.g. 100001" maxLength={64} />
            </div>
          </div>
          <div className="settings-form-row">
            <div className="settings-field">
              <span className="settings-label">Display name</span>
              <input className="text-input" value={userDraft.displayName ?? ''} onChange={(e) => setUserDraft({ ...userDraft, displayName: e.target.value })} placeholder="e.g. HR Admin" maxLength={255} />
            </div>
          </div>
          <div className="settings-form-row">
            <div className="settings-field">
              <span className="settings-label">Email</span>
              <input className="text-input" type="email" value={userDraft.email ?? ''} onChange={(e) => setUserDraft({ ...userDraft, email: e.target.value })} placeholder="optional" maxLength={255} />
            </div>
          </div>
          <div className="settings-form-row">
            <div className="settings-field">
              <span className="settings-label">Roles (comma-separated)</span>
              <input className="text-input" value={userRolesText} onChange={(e) => setUserRolesText(e.target.value)} placeholder="e.g. hr_admin, staff" maxLength={600} />
            </div>
          </div>
          <div className="settings-form-row">
            <div className="settings-field">
              <span className="settings-label">School IDs (comma-separated)</span>
              <input className="text-input" value={userSchoolIdsText} onChange={(e) => setUserSchoolIdsText(e.target.value)} placeholder="e.g. 3180103, 3180104" maxLength={600} />
            </div>
          </div>
          <label className="settings-checkbox">
            <input type="checkbox" checked={userDraft.canViewAllSchools ?? false} onChange={(e) => setUserDraft({ ...userDraft, canViewAllSchools: e.target.checked })} />
            <span>Can view all schools</span>
          </label>
          {userDraftError && <p className="settings-error">{userDraftError}</p>}
          <div className="settings-inline-actions">
            <button type="button" className="primary-button" onClick={handleSaveUser}>{editingUserId ? 'Save changes' : 'Add user'}</button>
            {editingUserId && <button type="button" className="ghost-button" onClick={resetUserDraft}>Cancel</button>}
          </div>

          <div className="system-messages-list">
            {loadingUsers && <p className="settings-hint">Loading…</p>}
            {!loadingUsers && users.length === 0 && <p className="settings-hint">No users.</p>}
            {users.map((user) => (
              <div key={user.id} className="system-message-item">
                <div className="system-message-item-main col">
                  <span className="system-message-item-title">{user.displayName}</span>
                  <span className="system-message-item-subtitle">{user.username}</span>
                  <span className="system-message-item-status">{user.roles.join(', ') || 'no roles'}</span>
                </div>
                <div className="system-message-item-actions">
                  <button type="button" className="icon-button subtle" onClick={() => startEditUser(user)} aria-label="Edit user" title="Edit"><span aria-hidden="true">✎</span></button>
                  <button type="button" className="icon-button subtle danger" onClick={() => handleDeleteUser(user)} aria-label="Delete user" title="Delete"><span aria-hidden="true">🗑</span></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  </div>;
}
