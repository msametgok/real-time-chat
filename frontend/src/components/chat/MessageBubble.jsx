import React from "react";

const formatMessageTime = (timestamp) => {
    if (!timestamp) return "";
    return new Date(timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
    })
}

const MessageStatusTicks = ({ message }) => {
    const isReadByAll = message.isReadByAll;
    const isDeliveredToAll = message.deliveredToAll;

    // --- DEBUGGING LOG ADDED HERE ---
  if (message.content.startsWith("Ticks test")) { // Change this to match your test message
     console.log(
        `%c[TICKS RENDER] For message "${message.content}":`,
        'color: #dc3545;',
        { isDeliveredToAll, isReadByAll }
     );
  }

    const tickColor = isReadByAll ? 'text-red-500' : 'text-slate-500';

    if (isDeliveredToAll || isReadByAll) {
        return (
            <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                className={`w-5 h-5 ${tickColor}`}
                aria-label={isReadByAll ? "Read by all" : "Delivered"}
            >
                <path fillRule="evenodd" d="M16.28 7.22a.75.75 0 010 1.06l-7.5 7.5a.75.75 0 01-1.06 0l-3.5-3.5a.75.75 0 111.06-1.06l2.97 2.97 6.97-6.97a.75.75 0 011.06 0zm-2.25 1.5a.75.75 0 010 1.06l-7.5 7.5a.75.75 0 01-1.06 0l-3.5-3.5a.75.75 0 111.06-1.06l2.97 2.97 6.97-6.97a.75.75 0 011.06 0z" clipRule="evenodd" />
            </svg>
        ); 
    }

    if (message.status === 'sent') {
        return (
            <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="w-5 h-5 text-slate-500"
                aria-label="Sent"
            >
                <path fillRule="evenodd" d="M16.28 7.22a.75.75 0 010 1.06l-7.5 7.5a.75.75 0 01-1.06 0l-3.5-3.5a.75.75 0 111.06-1.06l2.97 2.97 6.97-6.97a.75.75 0 011.06 0z" clipRule="evenodd" />
            </svg>
        );        
    }

    return null;
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