import React, { useMemo, useState, useRef, useEffect } from "react";
import { useChat } from '../../hooks/useChat';
import { useAuth } from '../../hooks/useAuth';
import { ChevronLeft, MoreVertical } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

function ChatWindowHeader() {
  const { activeChat, selectChat, presence, deleteChat } = useChat();
  const { user } = useAuth();

  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [removeError, setRemoveError] = useState(null);
  const menuRef = useRef(null);

  const closeMenu = () => {
    setIsMenuOpen(false);
    setIsConfirming(false);
    setRemoveError(null);
  };

  // Close on outside click or Escape - a menu that can only be dismissed by
  // its own button is a trap on touch.
  useEffect(() => {
    if (!isMenuOpen) return;
    const onDown = e => {
      if (menuRef.current && !menuRef.current.contains(e.target)) closeMenu();
    };
    const onKey = e => { if (e.key === 'Escape') closeMenu(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [isMenuOpen]);

  // Reset when switching chats, or the menu state leaks across conversations.
  useEffect(() => { closeMenu(); }, [activeChat?._id]);

  const handleRemove = async () => {
    if (isRemoving) return;
    setIsRemoving(true);
    setRemoveError(null);
    try {
      await deleteChat(activeChat._id);
      // No need to close: the chat is gone, so the header unmounts.
    } catch (err) {
      setRemoveError(err.message || 'Could not remove the chat.');
    } finally {
      setIsRemoving(false);
    }
  };

  const participantInfo = useMemo(() => {
    if (!activeChat) return "";
    const { isGroupChat, participants = [] } = activeChat;
    if (!isGroupChat && participants.length === 2) {
      const other = participants.find(p => p._id !== user._id);
      
      const { onlineStatus, lastSeen } = presence[other._id] || {};

      if (onlineStatus === 'online') {
        return 'Online';
      }
      if (lastSeen) {
        return `Last seen ${formatDistanceToNow(new Date(lastSeen))} ago`;
      }

      return 'Offline';
    }
    return `${participants.length} members`;
  }, [activeChat, user._id, presence]);

  if (!activeChat) {
    return null;
  }

  const { displayChatName, chatAvatar, isGroupChat } = activeChat;

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

      {/* Right side: per-chat actions */}
      <div className="relative flex-shrink-0" ref={menuRef}>
        <button
          onClick={() => (isMenuOpen ? closeMenu() : setIsMenuOpen(true))}
          aria-label="Chat options"
          aria-haspopup="menu"
          aria-expanded={isMenuOpen}
          className="p-2 rounded-full text-slate-400 hover:text-white hover:bg-slate-700
                     focus:outline-none"
        >
          <MoreVertical size={20} />
        </button>

        {isMenuOpen && (
          <div
            role="menu"
            className="absolute right-0 mt-2 w-64 rounded-md bg-slate-800 border border-slate-700
                       shadow-xl z-20 p-2"
          >
            {!isConfirming ? (
              <button
                role="menuitem"
                onClick={() => setIsConfirming(true)}
                className="w-full text-left px-3 py-2 rounded text-sm text-red-300
                           hover:bg-slate-700"
              >
                {isGroupChat ? 'Leave group' : 'Delete chat'}
              </button>
            ) : (
              <div className="p-1 space-y-3">
                {/* Says what actually happens: a 1-on-1 delete only hides the
                    chat for you, so there is no reason to alarm anyone. */}
                <p className="text-sm text-slate-300">
                  {isGroupChat
                    ? 'Leave this group? You will stop receiving its messages.'
                    : `Remove this chat from your list? ${displayChatName || 'They'} will still have it.`}
                </p>

                {removeError && (
                  <p role="alert" className="text-sm text-red-300">{removeError}</p>
                )}

                <div className="flex justify-end gap-2">
                  <button
                    onClick={closeMenu}
                    className="px-3 py-1.5 rounded text-sm text-slate-300 hover:bg-slate-700"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleRemove}
                    disabled={isRemoving}
                    className="px-3 py-1.5 rounded text-sm bg-red-600 text-white
                               hover:bg-red-500 disabled:opacity-50"
                  >
                    {isRemoving ? 'Removing...' : isGroupChat ? 'Leave' : 'Remove'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}

export default ChatWindowHeader;