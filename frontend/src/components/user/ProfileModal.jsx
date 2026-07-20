import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../hooks/useAuth';
import api from '../../services/api';
import ErrorMessage from '../common/ErrorMessage';

// View and edit your own profile.
//
// Only CHANGED fields are sent: the server treats every field as optional and
// checks uniqueness on username/email, so posting unchanged values would risk
// a spurious "already taken" against your own account.
//
// Avatar is a URL, not an upload - there is no upload route yet (that is the
// file-attachment work). An empty string clears it, which the server allows.
function ProfileModal({ isOpen, onClose }) {
    const { user, fetchUserProfile } = useAuth();

    const [username, setUsername] = useState('');
    const [email, setEmail] = useState('');
    const [avatar, setAvatar] = useState('');
    const [currentPassword, setCurrentPassword] = useState('');
    const [password, setPassword] = useState('');
    const [showPasswordFields, setShowPasswordFields] = useState(false);

    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState(null);
    const [notice, setNotice] = useState(null);

    // Seed from the already-loaded user rather than refetching: AuthContext
    // holds the same profile payload.
    const reset = useCallback(() => {
        setUsername(user?.username || '');
        setEmail(user?.email || '');
        setAvatar(user?.avatar || '');
        setCurrentPassword('');
        setPassword('');
        setShowPasswordFields(false);
        setError(null);
        setNotice(null);
        setIsSaving(false);
    }, [user]);

    useEffect(() => { if (isOpen) reset(); }, [isOpen, reset]);

    useEffect(() => {
        if (!isOpen) return;
        const onKey = e => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    const buildUpdates = () => {
        const updates = {};
        if (username.trim() && username.trim() !== user?.username) {
            updates.username = username.trim();
        }
        if (email.trim() && email.trim() !== user?.email) {
            updates.email = email.trim();
        }
        // Compared against '' so clearing an existing avatar is a real change.
        if (avatar.trim() !== (user?.avatar || '')) {
            updates.avatar = avatar.trim();
        }
        if (showPasswordFields && password) {
            updates.password = password;
            updates.currentPassword = currentPassword;
        }
        return updates;
    };

    const handleSubmit = async e => {
        e.preventDefault();
        if (isSaving) return;

        const updates = buildUpdates();
        if (Object.keys(updates).length === 0) {
            setNotice('Nothing to save.');
            return;
        }

        setIsSaving(true);
        setError(null);
        setNotice(null);
        try {
            await api.updateMyProfile(updates, user.token);
            // Re-read through AuthContext so the cached user and localStorage
            // both pick up the change - the sidebar reads username from there.
            await fetchUserProfile(user.token);
            onClose();
        } catch (err) {
            setError(err.message || 'Could not save your profile.');
        } finally {
            setIsSaving(false);
        }
    };

    const field = 'w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 ' +
                  'text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500';

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
            onClick={onClose}
        >
            <form
                role="dialog"
                aria-modal="true"
                aria-label="Your profile"
                onSubmit={handleSubmit}
                className="w-full max-w-md rounded-lg bg-slate-800 shadow-xl flex flex-col max-h-[85vh]"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-center justify-between p-4 border-b border-slate-700">
                    <h2 className="text-lg font-semibold text-slate-100">Your profile</h2>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close"
                        className="text-slate-400 hover:text-slate-200 text-xl leading-none"
                    >
                        &times;
                    </button>
                </div>

                <div className="p-4 space-y-4 overflow-y-auto custom-scrollbar">
                    <div className="flex items-center gap-3">
                        <span className="h-12 w-12 shrink-0 rounded-full bg-indigo-500 overflow-hidden
                                         flex items-center justify-center text-white font-semibold">
                            {avatar
                                ? <img src={avatar} alt="" className="w-full h-full object-cover" />
                                : (username || '?').charAt(0).toUpperCase()}
                        </span>
                        <p className="text-xs text-slate-400">
                            Avatar is an image URL for now. Uploads are not built yet.
                        </p>
                    </div>

                    <label className="block space-y-1">
                        <span className="text-sm text-slate-300">Username</span>
                        <input
                            type="text"
                            value={username}
                            onChange={e => setUsername(e.target.value)}
                            minLength={3}
                            maxLength={20}
                            className={field}
                        />
                    </label>

                    <label className="block space-y-1">
                        <span className="text-sm text-slate-300">Email</span>
                        <input
                            type="email"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            className={field}
                        />
                    </label>

                    <label className="block space-y-1">
                        <span className="text-sm text-slate-300">Avatar URL</span>
                        <input
                            type="url"
                            value={avatar}
                            onChange={e => setAvatar(e.target.value)}
                            placeholder="https://... (leave empty for none)"
                            className={field}
                        />
                    </label>

                    {!showPasswordFields ? (
                        <button
                            type="button"
                            onClick={() => setShowPasswordFields(true)}
                            className="text-sm text-indigo-400 hover:text-indigo-300"
                        >
                            Change password
                        </button>
                    ) : (
                        <div className="space-y-3 rounded-md border border-slate-700 p-3">
                            <label className="block space-y-1">
                                <span className="text-sm text-slate-300">Current password</span>
                                <input
                                    type="password"
                                    value={currentPassword}
                                    onChange={e => setCurrentPassword(e.target.value)}
                                    autoComplete="current-password"
                                    className={field}
                                />
                            </label>
                            <label className="block space-y-1">
                                <span className="text-sm text-slate-300">New password</span>
                                <input
                                    type="password"
                                    value={password}
                                    onChange={e => setPassword(e.target.value)}
                                    minLength={6}
                                    autoComplete="new-password"
                                    className={field}
                                />
                            </label>
                        </div>
                    )}

                    {error && <ErrorMessage message={error} />}
                    {notice && <p className="text-sm text-slate-400">{notice}</p>}
                </div>

                <div className="flex justify-end gap-2 p-4 border-t border-slate-700">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 rounded-md text-slate-300 hover:bg-slate-700"
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        disabled={isSaving}
                        className="px-4 py-2 rounded-md bg-indigo-600 text-white hover:bg-indigo-500
                                   disabled:opacity-40"
                    >
                        {isSaving ? 'Saving...' : 'Save changes'}
                    </button>
                </div>
            </form>
        </div>
    );
}

export default ProfileModal;
