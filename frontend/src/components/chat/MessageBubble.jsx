import React from "react";
import MessageStatusTicks from "./MessageStatusTicks";
import api from "../../services/api";
import { formatFileSize } from "../../utils/formatFileSize";

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

function MessageBubble({ message, isOwnMessage, showSenderInfo, onRetry }) {
    // Determine bubble alignment and color based on who sent it
    const bubbleAlignment = isOwnMessage ? "items-end": "items-start";
    const bubbleColor = message.failed
        ? 'bg-red-900/60 text-red-100 ring-1 ring-red-500'
        : isOwnMessage ? 'bg-indigo-600 text-white' : 'bg-slate-700 text-slate-200';

    const topMargin = showSenderInfo ? 'mt-4' : 'mt-1';

    // fileUrl OR localPreviewUrl: a just-picked attachment has no server URL
    // yet but must already render as its file, not as an empty text bubble.
    const isAttachment =
        ['image', 'video', 'audio', 'file'].includes(message.messageType) &&
        (message.fileUrl || message.localPreviewUrl || message.fileName);

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
            className={`relative max-w-xs lg:max-w-md px-4 py-2 rounded-xl shadow-md ${bubbleColor}`}
            >
                {showSenderInfo && (
                    <div className="font-semibold text-indigo-300 text-sm mb-1">
                    {message.sender?.username || 'User'}
                    </div>
                )}
                
                {/* break-words keeps an unbroken string inside max-w-xs instead
                    of blowing the bubble (and the list) out horizontally;
                    pre-wrap preserves the newlines Shift+Enter can now insert.
                    Attachments render their file first; `content` on them is an
                    optional caption, not a fallback placeholder. */}
                {isAttachment ? (
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
                            <span>{formatMessageTime(message.createdAt)}</span>
                            {isOwnMessage && <MessageStatusTicks message={message} />}
                        </>
                    )}
                </div>
            </div>

        </div>
        </div>
    );
}

export default MessageBubble;