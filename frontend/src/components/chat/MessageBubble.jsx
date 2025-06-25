import React from "react";
import MessageStatusTicks from "./MessageStatusTicks";

const formatMessageTime = (timestamp) => {
    if (!timestamp) return "";
    return new Date(timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
    })
}

function MessageBubble({ message, isOwnMessage, showSenderInfo }) {
    // Determine bubble alignment and color based on who sent it
    const bubbleAlignment = isOwnMessage ? "items-end": "items-start";
    const bubbleColor = isOwnMessage ? 'bg-indigo-600 text-white' : 'bg-slate-700 text-slate-200';

    const topMargin = showSenderInfo ? 'mt-4' : 'mt-1';

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
                
                <div>{message.content || '[Message content not available]'}</div>
                
                {/* Timestamp and Status Ticks */}
                <div className={`text-xs pt-1 text-right flex items-center justify-end gap-1 ${isOwnMessage ? 'text-indigo-200' : 'text-slate-400'}`}>
                    <span>{formatMessageTime(message.createdAt)}</span>
                    {isOwnMessage && <MessageStatusTicks message={message} />}
                </div>
            </div>

        </div>
        </div>
    );
}

export default MessageBubble;