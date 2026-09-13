import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { HomePage } from './homePage';
import type { LoginSession, SystemUser, SystemUserInput } from './types';
import {
  getUsers,
  createUser,
  updateUser,
  deleteUser,
} from './api';

const HOME_PAGE_OPTIONS: { value: HomePage; label: string }[] = [
  { value: 'home', label: 'Home' },
  { value: 'reports', label: 'Reports' },
  { value: 'kpi', label: 'Dashboard' },
];

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
// admins only) the user manager. System-wide messages used to live here too;
// they now have their own page (SystemMessagesPage), reached from Features.
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
