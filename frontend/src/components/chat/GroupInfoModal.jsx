import React, { useState, useEffect, useRef } from 'react';
import { useChat } from '../../hooks/useChat';
import { useAuth } from '../../hooks/useAuth';
import LoadingSpinner from '../common/LoadingSpinner';

// Group details and admin actions. Members see the participant list; the
// admin can additionally rename the group, change its avatar URL, add
// members, and remove them.
//
// No local participant bookkeeping: every successful action makes the server
// broadcast groupUpdated, ChatContext refetches, activeChat is replaced, and
// this modal re-renders from it. Errors are shown HERE, not via chatError -
// that state replaces the whole sidebar (same reasoning as NewChatModal).
function GroupInfoModal({ isOpen, onClose }) {
    const {
        activeChat,
        updateGroupChatAPI,
        addGroupParticipantsAPI,
        removeGroupParticipantAPI,
        searchUsers
    } = useChat();
    const { user } = useAuth();

    const [name, setName] = useState('');
    const [avatarUrl, setAvatarUrl] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState(null);

    const [keyword, setKeyword] = useState('');
    const [results, setResults] = useState([]);
    const [isSearching, setIsSearching] = useState(false);
    // Ids with an add/remove in flight, so their buttons can disable alone.
    const [busyIds, setBusyIds] = useState(new Set());

    const debounceRef = useRef(null);
    const searchSeqRef = useRef(0);

    const adminId = activeChat?.groupAdmin?._id || activeChat?.groupAdmin;
    const isAdmin = !!adminId && adminId.toString() === user?._id?.toString();
    const participants = activeChat?.participants || [];
    const memberIds = new Set(participants.map(p => (p._id || p).toString()));

    // Re-seed the editable fields each time the modal opens (or the group is
    // renamed elsewhere while it is open and untouched - keyed on activeChat).
    useEffect(() => {
        if (!isOpen) return;
        setName(activeChat?.chatName || '');
        setAvatarUrl(activeChat?.groupAvatarUrl || '');
        setError(null);
        setKeyword('');
        setResults([]);
    }, [isOpen, activeChat?._id]);

    // Member search (admin only), debounced like NewChatModal.
    useEffect(() => {
        if (!isOpen || !isAdmin) return;

        clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(async () => {
            const seq = ++searchSeqRef.current;
            setIsSearching(true);
            try {
                const users = await searchUsers(keyword, { limit: 20 });
                if (searchSeqRef.current !== seq) return; // superseded
                setResults(users);
            } catch (err) {
                if (searchSeqRef.current !== seq) return;
                setError(err.message || 'Could not search users.');
                setResults([]);
            } finally {
                if (searchSeqRef.current === seq) setIsSearching(false);
            }
        }, 250);

        return () => clearTimeout(debounceRef.current);
    }, [isOpen, isAdmin, keyword, searchUsers]);

    // Close on Escape, the shortcut people reach for before the button.
    useEffect(() => {
        if (!isOpen) return;
        const onKey = e => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [isOpen, onClose]);

    if (!isOpen || !activeChat?.isGroupChat) return null;

    const markBusy = (id, busy) => setBusyIds(prev => {
        const next = new Set(prev);
        if (busy) next.add(id); else next.delete(id);
        return next;
    });

    const handleSaveDetails = async (e) => {
        e.preventDefault();
        const updates = {};
        if (name.trim() && name.trim() !== activeChat.chatName) updates.chatName = name.trim();
        if (avatarUrl.trim() !== (activeChat.groupAvatarUrl || '')) updates.groupAvatarUrl = avatarUrl.trim();
        if (Object.keys(updates).length === 0) return;

        setIsSaving(true);
        setError(null);
        try {
            await updateGroupChatAPI(activeChat._id, updates);
        } catch (err) {
            setError(err.message || 'Could not update the group.');
        } finally {
            setIsSaving(false);
        }
    };

    const handleAdd = async (userId) => {
        markBusy(userId, true);
        setError(null);
        try {
            await addGroupParticipantsAPI(activeChat._id, [userId]);
        } catch (err) {
            setError(err.message || 'Could not add the member.');
        } finally {
            markBusy(userId, false);
        }
    };

    const handleRemove = async (userId) => {
        markBusy(userId, true);
        setError(null);
        try {
            await removeGroupParticipantAPI(activeChat._id, userId);
        } catch (err) {
            setError(err.message || 'Could not remove the member.');
        } finally {
            markBusy(userId, false);
        }
    };

    const addable = results.filter(u => !memberIds.has(u._id.toString()));

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
            onClick={onClose}
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-label="Group info"
                className="w-full max-w-md rounded-lg bg-slate-800 shadow-xl flex flex-col max-h-[85vh]"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-center justify-between p-4 border-b border-slate-700">
                    <h2 className="text-lg font-semibold text-slate-100">Group info</h2>
                    <button
                        onClick={onClose}
                        aria-label="Close"
                        className="text-slate-400 hover:text-slate-200 text-xl leading-none"
                    >
                        &times;
                    </button>
                </div>

                <div className="p-4 space-y-4 overflow-y-auto custom-scrollbar">
                    {error && (
                        <p role="alert" className="text-sm text-red-300">{error}</p>
                    )}

                    {isAdmin ? (
                        <form onSubmit={handleSaveDetails} className="space-y-2">
                            <input
                                type="text"
                                value={name}
                                onChange={e => setName(e.target.value)}
                                aria-label="Group name"
                                maxLength={100}
                                className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2
                                           text-slate-100 placeholder-slate-500 focus:outline-none
                                           focus:border-indigo-500"
                            />
                            <input
                                type="text"
                                value={avatarUrl}
                                onChange={e => setAvatarUrl(e.target.value)}
                                placeholder="Avatar URL (empty to remove)"
                                aria-label="Group avatar URL"
                                className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2
                                           text-slate-100 placeholder-slate-500 focus:outline-none
                                           focus:border-indigo-500"
                            />
                            <div className="flex justify-end">
                                <button
                                    type="submit"
                                    disabled={isSaving}
                                    className="px-4 py-1.5 rounded-md text-sm bg-indigo-600 text-white
                                               hover:bg-indigo-700 disabled:opacity-50"
                                >
                                    {isSaving ? 'Saving...' : 'Save'}
                                </button>
                            </div>
                        </form>
                    ) : (
                        <div>
                            <h3 className="text-base font-semibold text-slate-100">{activeChat.chatName}</h3>
                        </div>
                    )}

                    <div>
                        <h3 className="text-sm font-semibold text-slate-400 mb-2">
                            {participants.length} members
                        </h3>
                        <ul className="space-y-1">
                            {participants.map(p => {
                                const pid = (p._id || p).toString();
                                const isSelf = pid === user?._id?.toString();
                                const isGroupAdmin = pid === adminId?.toString();
                                return (
                                    <li key={pid} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded hover:bg-slate-700/50">
                                        <span className="truncate text-slate-200">
                                            {p.username || 'User'}{isSelf ? ' (you)' : ''}
                                            {isGroupAdmin && (
                                                <span className="ml-2 text-xs text-indigo-300 border border-indigo-400/50 rounded px-1">
                                                    admin
                                                </span>
                                            )}
                                        </span>
                                        {isAdmin && !isSelf && (
                                            <button
                                                onClick={() => handleRemove(pid)}
                                                disabled={busyIds.has(pid)}
                                                className="text-xs text-red-300 hover:text-red-200 disabled:opacity-50"
                                            >
                                                {busyIds.has(pid) ? 'Removing...' : 'Remove'}
                                            </button>
                                        )}
                                    </li>
                                );
                            })}
                        </ul>
                    </div>

                    {isAdmin && (
                        <div>
                            <h3 className="text-sm font-semibold text-slate-400 mb-2">Add members</h3>
                            <input
                                type="text"
                                value={keyword}
                                onChange={e => setKeyword(e.target.value)}
                                placeholder="Search by username or email"
                                aria-label="Search users to add"
                                className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2
                                           text-slate-100 placeholder-slate-500 focus:outline-none
                                           focus:border-indigo-500"
                            />
                            {isSearching ? (
                                <div className="flex justify-center py-3"><LoadingSpinner /></div>
                            ) : (
                                <ul className="mt-2 space-y-1 max-h-40 overflow-y-auto custom-scrollbar">
                                    {addable.map(u => (
                                        <li key={u._id} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded hover:bg-slate-700/50">
                                            <span className="truncate text-slate-200">{u.username}</span>
                                            <button
                                                onClick={() => handleAdd(u._id)}
                                                disabled={busyIds.has(u._id)}
                                                className="text-xs text-indigo-300 hover:text-indigo-200 disabled:opacity-50"
                                            >
                                                {busyIds.has(u._id) ? 'Adding...' : 'Add'}
                                            </button>
                                        </li>
                                    ))}
                                    {addable.length === 0 && (
                                        <li className="px-2 py-1.5 text-sm text-slate-500">No one to add.</li>
                                    )}
                                </ul>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export default GroupInfoModal;
