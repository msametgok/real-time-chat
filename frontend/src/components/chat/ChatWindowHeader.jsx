import React from "react";
import { useChat } from '../../hooks/useChat';

function ChatWindowHeader() {
    const { activeChat } = useChat();

    if (!activeChat) {
        return null;
    }

    const { displayChatName, chatAvatar, isGroupChat } = activeChat;

    // For 1-on-1 chats, show user's online status
    const getOtherParticipantStatus = () => {
        if (!isGroupChat && activeChat.participants.length === 2) {
            const otherParticipant = activeChat.participants[0];
            return `${activeChat.participants.length} members`
        }
        return `${activeChat.participants.length} members`;
    }

    return (
    <div className="flex sm:items-center justify-between py-3 px-4 border-b-2 border-slate-700">
      <div className="relative flex items-center space-x-4">
        <div className="relative">
          <div className="h-10 w-10 sm:h-12 sm:w-12 rounded-full bg-indigo-400 text-white font-semibold overflow-hidden flex-shrink-0 flex items-center justify-center">
            {chatAvatar ? (
              <img src={chatAvatar} alt={displayChatName} className="w-full h-full object-cover" />
            ) : (
              (displayChatName || 'C')?.charAt(0).toUpperCase()
            )}
          </div>
          {/* Online status indicator - we can wire this up later */}
          {/* <span className="absolute text-green-500 right-0 bottom-0">
            <svg width="20" height="20">
              <circle cx="8" cy="8" r="8" fill="currentColor"></circle>
            </svg>
          </span> */}
        </div>
        <div className="flex flex-col leading-tight">
          <div className="text-lg sm:text-xl font-semibold mt-1 flex items-center">
            <span className="text-slate-200 mr-3">{displayChatName || 'Chat'}</span>
          </div>
          <span className="text-xs sm:text-sm text-slate-500">
            {getOtherParticipantStatus()}
          </span>
        </div>
      </div>
      <div className="flex items-center space-x-2">
        {/* Placeholder for action buttons like call, video call, info */}
        <button type="button" className="inline-flex items-center justify-center rounded-lg border h-10 w-10 sm:h-12 sm:w-12 transition duration-500 ease-in-out text-slate-400 hover:bg-slate-700 focus:outline-none">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" className="h-6 w-6">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
          </svg>
        </button>
      </div>
    </div>
  );
}

export default ChatWindowHeader;
