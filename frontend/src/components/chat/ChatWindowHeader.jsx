import React, { useMemo } from "react";
import { useChat } from '../../hooks/useChat';
import { useAuth } from '../../hooks/useAuth';
import { ChevronLeft } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

function ChatWindowHeader() {
  const { activeChat, selectChat } = useChat();
  const { user } = useAuth();

  const participantInfo = useMemo(() => {
    if (!activeChat) return "";
    const { isGroupChat, participants = [] } = activeChat;
    if (!isGroupChat && participants.length === 2) {
      const other = participants.find(p => p._id !== user._id);
      if (other?.onlineStatus === 'online') {
        return 'Online';
      }
      if (other?.lastSeen) {
        return `Last seen ${formatDistanceToNow(new Date(other.lastSeen))} ago`;
      }
      return 'Offline';
    }
    return `${participants.length} members`;
  }, [activeChat, user._id]);

  if (!activeChat) {
    return null;
  }

  const { displayChatName, chatAvatar } = activeChat;

  return (
    <header className="flex items-center justify-between py-3 px-4 bg-slate-800 backdrop-blur-sm shadow-sm border-b border-slate-700">
      {/* Left side: back button (<md) + avatar */}
      <div className="flex items-center space-x-3">
        {/* Back arrow only on screens narrower than md */}
        <button
          onClick={() => selectChat(null)}
          className="md:hidden inline-flex items-center justify-center text-slate-400 hover:text-white focus:outline-none"
          aria-label="Back to chat list"
          title="Back"
        >
          <ChevronLeft size={24} />
        </button>

        {/* Avatar */}
        <div className="h-10 w-10 rounded-full bg-indigo-400 text-white font-semibold overflow-hidden flex items-center justify-center flex-shrink-0"
        role="img"
        aria-label={`Avatar of ${displayChatName}`}>
          {chatAvatar
            ? <img src={chatAvatar} alt={displayChatName} className="w-full h-full object-cover" />
            : (displayChatName?.charAt(0).toUpperCase() || 'C')}
        </div>

        {/* Title and member count */}
        <div className="flex flex-col leading-tight overflow-hidden">
          <h1 className="text-lg font-semibold text-slate-200 truncate">
            {displayChatName || 'Chat'}
          </h1>
          <p className="text-xs text-slate-500 truncate">
            {participantInfo}
          </p>
        </div>
      </div>

      {/* Right side intentionally left blank (for future controls) */}
    </header>
  );
}

export default ChatWindowHeader;