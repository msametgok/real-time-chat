import React, { useState } from "react";
import MessageStatusTicks from "./MessageStatusTicks";
import api from "../../services/api";
import { formatFileSize } from "../../utils/formatFileSize";

// Mirror of the server's editMessage window. Hiding the option here is
// cosmetic - the server enforces the real limit and answers messageError.
const EDIT_WINDOW_MS = 15 * 60 * 1000;

const formatMessageTime = (timestamp) => {
    if (!timestamp) return "";
    return new Date(timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
    })
}

// The file part of an image/video/audio/file message. `src` is the local blob
// preview while the upload is still in flight, the server URL afterwards -
// for a generic file mid-upload there is no URL at all yet, so the card
// renders without a link.
function AttachmentContent({ message }) {
    const src = message.localPreviewUrl || api.resolveFileUrl(message.fileUrl);

    if (message.messageType === 'image' && src) {
        return (
            <a href={src} target="_blank" rel="noreferrer">
                <img
                    src={src}
                    alt={message.fileName || 'Image'}
                    className="rounded-lg max-h-64 max-w-full object-contain"
                />
            </a>
        );
    }

    if (message.messageType === 'video' && src) {
        return <video controls src={src} className="rounded-lg max-h-64 max-w-full" />;
    }

    if (message.messageType === 'audio' && src) {
        return <audio controls src={src} className="max-w-full" />;
    }

    const card = (
        <span className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" className="h-8 w-8 flex-shrink-0 opacity-75">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
            <span className="min-w-0">
                <span className="block truncate font-medium">{message.fileName || 'File'}</span>
                <span className="block text-xs opacity-75">{formatFileSize(message.fileSize)}</span>
            </span>
        </span>
    );

    // Not on the server yet (still uploading, or the upload failed): no link.
    if (!message.fileUrl) return card;

    return (
        <a
            href={api.resolveFileUrl(message.fileUrl)}
            target="_blank"
            rel="noreferrer"
            download={message.fileName}
            className="hover:underline"
        >
            {card}
        </a>
    );
}

function MessageBubble({ message, isOwnMessage, showSenderInfo, onRetry, onEdit, onDeleteForMe, onDeleteForEveryone }) {
    const [menuOpen, setMenuOpen] = useState(false);
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState('');

    // Determine bubble alignment and color based on who sent it
    const bubbleAlignment = isOwnMessage ? "items-end": "items-start";
    const bubbleColor = message.failed
        ? 'bg-red-900/60 text-red-100 ring-1 ring-red-500'
        : isOwnMessage ? 'bg-indigo-600 text-white' : 'bg-slate-700 text-slate-200';

    const topMargin = showSenderInfo ? 'mt-4' : 'mt-1';

    const isDeleted = !!message.isDeletedForEveryone;

    // fileUrl OR localPreviewUrl: a just-picked attachment has no server URL
    // yet but must already render as its file, not as an empty text bubble.
    const isAttachment =
        !isDeleted &&
        ['image', 'video', 'audio', 'file'].includes(message.messageType) &&
        (message.fileUrl || message.localPreviewUrl || message.fileName);

    // Evaluated on render, so a menu opened later re-checks the clock. The
    // server re-checks regardless.
    const withinEditWindow =
        Date.now() - new Date(message.createdAt).getTime() <= EDIT_WINDOW_MS;
    const canEdit = !!onEdit && isOwnMessage && message.messageType === 'text' && withinEditWindow;
    const canDeleteForEveryone = !!onDeleteForEveryone && isOwnMessage;

    // No menu on tombstones, or on bubbles that only exist client-side: a
    // sending/failed message has a temp id the server has never heard of.
    const showMenu =
        !isDeleted && !message.sending && !message.failed &&
        (canEdit || canDeleteForEveryone || !!onDeleteForMe);

    const startEditing = () => {
        setDraft(message.content || '');
        setEditing(true);
        setMenuOpen(false);
    };

    const saveEdit = () => {
        const trimmed = draft.trim();
        if (trimmed && trimmed !== message.content) {
            onEdit(message._id, trimmed);
        }
        setEditing(false);
    };

    return (
        <div className={`flex flex-col ${bubbleAlignment} ${topMargin}`}>
        <div className="flex items-end">
            
            {/* Avatar for received messages */}
            {!isOwnMessage && (
            <div className="w-8 mr-2 flex-shrink-0">
                {showSenderInfo && (
                <div className="flex items-center justify-center h-8 w-8 rounded-full bg-indigo-400 text-white font-semibold overflow-hidden">
                    {message.sender?.avatar ? (
                    <img src={message.sender.avatar} alt={message.sender.username} className="w-full h-full object-cover" />
                    ) : (
                    message.sender?.username?.charAt(0).toUpperCase() || '?'
                    )}
                </div>
                )}
            </div>
            )}

            {/* Message Bubble */}
            <div
            className={`relative group max-w-xs lg:max-w-md px-4 py-2 rounded-xl shadow-md ${bubbleColor}`}
            >
                {showSenderInfo && (
                    <div className="font-semibold text-indigo-300 text-sm mb-1">
                    {message.sender?.username || 'User'}
                    </div>
                )}

                {showMenu && (
                    <button
                        type="button"
                        aria-label="Message options"
                        onClick={() => setMenuOpen(open => !open)}
                        className="absolute top-1 right-1 z-10 h-5 w-5 flex items-center justify-center
                                   rounded-full bg-black/30 text-white/80 hover:text-white
                                   opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                            <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                    </button>
                )}

                {menuOpen && (
                    <>
                        {/* Invisible backdrop: any click outside closes the menu. */}
                        <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                        <div
                            role="menu"
                            className="absolute right-0 top-6 z-20 min-w-[11rem] py-1 rounded-md
                                       bg-slate-900 border border-slate-700 shadow-lg text-sm text-slate-200"
                        >
                            {canEdit && (
                                <button
                                    type="button"
                                    role="menuitem"
                                    onClick={startEditing}
                                    className="block w-full text-left px-4 py-2 hover:bg-slate-700"
                                >
                                    Edit
                                </button>
                            )}
                            {canDeleteForEveryone && (
                                <button
                                    type="button"
                                    role="menuitem"
                                    onClick={() => { setMenuOpen(false); onDeleteForEveryone(message._id); }}
                                    className="block w-full text-left px-4 py-2 text-red-400 hover:bg-slate-700"
                                >
                                    Delete for everyone
                                </button>
                            )}
                            {onDeleteForMe && (
                                <button
                                    type="button"
                                    role="menuitem"
                                    onClick={() => { setMenuOpen(false); onDeleteForMe(message._id); }}
                                    className="block w-full text-left px-4 py-2 hover:bg-slate-700"
                                >
                                    Delete for me
                                </button>
                            )}
                        </div>
                    </>
                )}

                {/* break-words keeps an unbroken string inside max-w-xs instead
                    of blowing the bubble (and the list) out horizontally;
                    pre-wrap preserves the newlines Shift+Enter can now insert.
                    Attachments render their file first; `content` on them is an
                    optional caption, not a fallback placeholder. */}
                {isDeleted ? (
                    <div className="italic opacity-70">This message was deleted</div>
                ) : editing ? (
                    <div className="w-64 max-w-full">
                        <textarea
                            autoFocus
                            rows={2}
                            value={draft}
                            onChange={e => setDraft(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(); }
                                if (e.key === 'Escape') setEditing(false);
                            }}
                            aria-label="Edit message"
                            className="w-full rounded-md bg-slate-900/60 text-slate-100 p-2 text-sm
                                       resize-none focus:outline-none focus:ring-1 focus:ring-indigo-400"
                        />
                        <div className="flex justify-end gap-3 mt-1 text-xs">
                            <button type="button" onClick={() => setEditing(false)} className="opacity-80 hover:opacity-100">
                                Cancel
                            </button>
                            <button type="button" onClick={saveEdit} className="font-semibold hover:underline">
                                Save
                            </button>
                        </div>
                    </div>
                ) : isAttachment ? (
                    <>
                        <AttachmentContent message={message} />
                        {message.content && (
                            <div className="whitespace-pre-wrap break-words mt-1">{message.content}</div>
                        )}
                    </>
                ) : (
                    <div className="whitespace-pre-wrap break-words">{message.content || '[Message content not available]'}</div>
                )}

                {/* Timestamp and Status Ticks */}
                <div className={`text-xs pt-1 text-right flex items-center justify-end gap-1 ${isOwnMessage ? 'text-indigo-200' : 'text-slate-400'}`}>
                    {message.failed ? (
                        <>
                            <span className="text-red-300 font-medium">Not delivered</span>
                            {onRetry && (
                                <button
                                    type="button"
                                    onClick={() => onRetry(message._id)}
                                    className="ml-1 underline text-red-200 hover:text-white font-medium"
                                >
                                    Retry
                                </button>
                            )}
                        </>
                    ) : (
                        <>
                            {message.editedAt && !isDeleted && <span className="italic opacity-80">edited</span>}
                            <span>{formatMessageTime(message.createdAt)}</span>
                            {isOwnMessage && !isDeleted && <MessageStatusTicks message={message} />}
                        </>
                    )}
                </div>
            </div>

        </div>
        </div>
    );
}

export default MessageBubble;