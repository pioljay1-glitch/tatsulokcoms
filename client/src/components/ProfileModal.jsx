import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { avatarSrc } from '../utils/avatar';

export default function ProfileModal({ onClose }) {
  const { user, updateProfile, changePassword, logout } = useAuth();
  const [tab, setTab] = useState('profile');
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [username, setUsername] = useState(user?.username || '');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNew, setConfirmNew] = useState('');

  const handleProfileSave = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setSaving(true);
    try {
      await updateProfile({ displayName: displayName.trim(), username: username.trim() });
      setSuccess('Profile updated.');
    } catch (err) {
      setError(err.message || 'Update failed.');
    } finally {
      setSaving(false);
    }
  };

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (newPassword !== confirmNew) {
      setError('New passwords do not match.');
      return;
    }
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    setSaving(true);
    try {
      await changePassword(currentPassword, newPassword);
      setSuccess('Password changed successfully.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNew('');
    } catch (err) {
      setError(err.message || 'Password change failed.');
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Account Settings</h2>
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
          <button type="button" className={tab === 'profile' ? '' : 'secondary'} onClick={() => { setTab('profile'); setError(''); setSuccess(''); }}>Profile</button>
          <button type="button" className={tab === 'security' ? '' : 'secondary'} onClick={() => { setTab('security'); setError(''); setSuccess(''); }}>Security</button>
        </div>
        {error ? <div className={'error-banner'}>{error}</div> : null}
        {success ? <div className={'success-banner'}>{success}</div> : null}
        {tab === 'profile' && (
          <form onSubmit={handleProfileSave}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1rem' }}>
              <div className="avatar lg"><img src={avatarSrc(user)} alt="" /></div>
            </div>
            <div className="form-group">
              <label>Display name</label>
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required maxLength={64} />
            </div>
            <div className="form-group">
              <label>Username</label>
              <input value={username} onChange={(e) => setUsername(e.target.value)} required minLength={3} maxLength={32} />
            </div>
            <div className="form-group">
              <label>Email</label>
              <input value={user?.email || ''} disabled />
            </div>
            {user?.createdAt && (
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                Member since {new Date(user.createdAt).toLocaleDateString()}
              </p>
            )}
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={onClose}>Cancel</button>
              <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        )}
        {tab === 'security' && (
          <form onSubmit={handlePasswordChange}>
            <div className="form-group">
              <label>Current password</label>
              <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
            </div>
            <div className="form-group">
              <label>New password</label>
              <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8} />
            </div>
            <div className="form-group">
              <label>Confirm new password</label>
              <input type="password" value={confirmNew} onChange={(e) => setConfirmNew(e.target.value)} required minLength={8} />
            </div>
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={onClose}>Cancel</button>
              <button type="submit" disabled={saving}>{saving ? 'Updating…' : 'Change password'}</button>
            </div>
          </form>
        )}
        <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '1.25rem 0' }} />
        <button type="button" className="danger" style={{ width: '100%' }} onClick={handleLogout}>Log Out</button>
      </div>
    </div>
  );
}
