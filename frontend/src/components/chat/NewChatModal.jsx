import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useChat } from '../../hooks/useChat';
import LoadingSpinner from '../common/LoadingSpinner';
import ErrorMessage from '../common/ErrorMessage';

// Start a conversation: search users, pick one for a direct chat or several
// for a group.
//
// Errors are shown HERE rather than pushed into the context's `chatError`,
// which ChatList renders instead of the sidebar - a failed create must not
// blank the chat list behind the modal.
function NewChatModal({ isOpen, onClose }) {
    const { searchUsers, createOneOnOneChatAPI, createGroupChatAPI } = useChat();

    const [keyword, setKeyword] = useState('');
    const [results, setResults] = useState([]);
    const [selected, setSelected] = useState([]);
    const [groupName, setGroupName] = useState('');
    const [isSearching, setIsSearching] = useState(false);
    const [isCreating, setIsCreating] = useState(false);
    const [error, setError] = useState(null);

    // Timer in a ref, not a plain `let`: a component-scoped variable resets on
    // every render and clearTimeout silently no-ops (gotcha 3).
    const debounceRef = useRef(null);
    // Only the newest search may write results. Typing fast leaves several
    // requests in flight and the slowest would otherwise land last.
    const searchSeqRef = useRef(0);

    const isGroup = selected.length > 1;

    const reset = useCallback(() => {
        setKeyword('');
        setResults([]);
        setSelected([]);
        setGroupName('');
        setError(null);
        setIsSearching(false);
        setIsCreating(false);
    }, []);

    // Search on open (empty keyword lists everyone) and on every keystroke.
    useEffect(() => {
        if (!isOpen) return;

        clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(async () => {
            const seq = ++searchSeqRef.current;
            setIsSearching(true);
            try {
                const users = await searchUsers(keyword, { limit: 20 });
                if (searchSeqRef.current !== seq) return; // superseded
                setResults(users);
                setError(null);
            } catch (err) {
                if (searchSeqRef.current !== seq) return;
                setError(err.message || 'Could not search users.');
                setResults([]);
            } finally {
                if (searchSeqRef.current === seq) setIsSearching(false);
            }
        }, 250);

        return () => clearTimeout(debounceRef.current);
    }, [isOpen, keyword, searchUsers]);

    // Close on Escape, the shortcut people reach for before the button.
    useEffect(() => {
        if (!isOpen) return;
        const onKey = e => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [isOpen, onClose]);

    useEffect(() => { if (!isOpen) reset(); }, [isOpen, reset]);

    if (!isOpen) return null;

    const toggle = user => {
        setSelected(prev =>
            prev.some(u => u._id === user._id)
                ? prev.filter(u => u._id !== user._id)
                : [...prev, user]
        );
    };

    const handleCreate = async () => {
        if (selected.length === 0 || isCreating) return;
        setIsCreating(true);
        setError(null);
        try {
            if (isGroup) {
                await createGroupChatAPI(groupName.trim(), selected.map(u => u._id));
            } else {
                await createOneOnOneChatAPI(selected[0]._id);
            }
            onClose();
        } catch (err) {
            // Stay open so the picked users aren't lost on a transient failure.
            setError(err.message || 'Could not start the chat.');
        } finally {
            setIsCreating(false);
        }
    };

    const canCreate =
        selected.length > 0 && (!isGroup || groupName.trim().length > 0) && !isCreating;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
            onClick={onClose}
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-label="Start a new chat"
                className="w-full max-w-md rounded-lg bg-slate-800 shadow-xl flex flex-col max-h-[80vh]"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-center justify-between p-4 border-b border-slate-700">
                    <h2 className="text-lg font-semibold text-slate-100">New chat</h2>
                    <button
                        onClick={onClose}
                        aria-label="Close"
                        className="text-slate-400 hover:text-slate-200 text-xl leading-none"
                    >
                        &times;
                    </button>
                </div>

                <div className="p-4 space-y-3">
                    <input
                        type="text"
                        autoFocus
                        value={keyword}
                        onChange={e => setKeyword(e.target.value)}
                        placeholder="Search by username or email"
                        aria-label="Search users"
                        className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2
                                   text-slate-100 placeholder-slate-500 focus:outline-none
                                   focus:border-indigo-500"
                    />

                    {isGroup && (
                        <input
                            type="text"
                            value={groupName}
                            onChange={e => setGroupName(e.target.value)}
                            placeholder="Group name (required)"
                            aria-label="Group name"
                            maxLength={100}
                            className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2
                                       text-slate-100 placeholder-slate-500 focus:outline-none
                                       focus:border-indigo-500"
                        />
                    )}

                    {selected.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                            {selected.map(u => (
                                <button
                                    key={u._id}
                                    onClick={() => toggle(u)}
                                    className="flex items-center gap-1 rounded-full bg-indigo-600
                                               px-3 py-1 text-sm text-white hover:bg-indigo-500"
                                >
                                    {u.username}
                                    <span aria-hidden="true">&times;</span>
                                    <span className="sr-only">Remove {u.username}</span>
                                </button>
                            ))}
                        </div>
                    )}

                    {error && <ErrorMessage message={error} />}
                </div>

                <div className="flex-grow overflow-y-auto px-4 custom-scrollbar min-h-[8rem]">
                    {isSearching && results.length === 0 ? (
                        <div className="flex justify-center py-6"><LoadingSpinner /></div>
                    ) : results.length === 0 ? (
                        <p className="text-slate-400 italic text-center py-6">
                            {keyword ? `No users match "${keyword}".` : 'No other users yet.'}
                        </p>
                    ) : (
                        <ul className="space-y-1 pb-2">
                            {results.map(u => {
                                const isPicked = selected.some(s => s._id === u._id);
                                return (
                                    <li key={u._id}>
                                        <button
                                            onClick={() => toggle(u)}
                                            aria-pressed={isPicked}
                                            className={`w-full flex items-center gap-3 rounded-md px-3 py-2
                                                        text-left transition-colors ${
                                                isPicked
                                                    ? 'bg-indigo-600/30 text-indigo-100'
                                                    : 'text-slate-200 hover:bg-slate-700'
                                            }`}
                                        >
                                            {/* Same fallback as ChatList: there is no
                                                default-avatar asset, so an <img> with a
                                                placeholder src would 404 and render broken. */}
                                            <span className="h-8 w-8 shrink-0 rounded-full bg-slate-600
                                                             flex items-center justify-center overflow-hidden
                                                             text-sm font-semibold text-slate-200">
                                                {u.avatar
                                                    ? <img src={u.avatar} alt="" className="w-full h-full object-cover" />
                                                    : (u.username || '?').charAt(0).toUpperCase()}
                                            </span>
                                            <span className="truncate">{u.username}</span>
                                            {isPicked && <span className="ml-auto text-indigo-300">✓</span>}
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>

                <div className="flex items-center justify-between gap-3 p-4 border-t border-slate-700">
                    <span className="text-sm text-slate-400">
                        {selected.length === 0
                            ? 'Pick someone to start'
                            : isGroup
                                ? `Group of ${selected.length + 1}`
                                : `Direct chat with ${selected[0].username}`}
                    </span>
                    <button
                        onClick={handleCreate}
                        disabled={!canCreate}
                        className="rounded-md bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-500
                                   disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        {isCreating ? 'Starting...' : isGroup ? 'Create group' : 'Start chat'}
                    </button>
                </div>
            </div>
        </div>
    );
}

export default NewChatModal;
