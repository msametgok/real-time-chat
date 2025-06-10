import React from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useChat } from '../../hooks/useChat';
import ErrorMessage from '../common/ErrorMessage';
import LoadingSpinner from '../common/LoadingSpinner';

function ChatListItem({ chat, currentUserId, isActive, onSelectChat }) {
  const { displayChatName, chatAvatar, latestMessage } = chat;

  let lastMessageText = 'No messages yet';
  let lastMessageTime = '';
  let senderPrefix = '';

  if (latestMessage && typeof latestMessage === 'object') {

    if (latestMessage.sender && typeof latestMessage.sender === 'object' && currentUserId && latestMessage.sender._id === currentUserId) {
      senderPrefix = "You: ";
    } else if (latestMessage.sender && typeof latestMessage.sender === 'object' && chat.isGroupChat) {
      senderPrefix = `${latestMessage.sender.username}:`;
    }

    // Determine message text (content or file name)
    if (latestMessage.messageType === 'text') {
      lastMessageText = latestMessage.content || '';
    } else if (latestMessage.fileName) {
      lastMessageText = latestMessage.fileName;
    } else if (latestMessage.messageType && latestMessage.messageType !== 'text') {
      lastMessageText = `${latestMessage.messageType.charAt(0).toUpperCase() + latestMessage.messageType.slice(1)}`;
    }

    // Format time
    if(latestMessage.createdAt) {
      lastMessageTime = new Date(latestMessage.createdAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit', 
      });
    }
    
  }

  // Determine display name for 1-on-1 chats if not already formatted
  // (formatChatResponse in ChatContext should handle this, but as a fallback)
  let nameToDisplay = displayChatName;
  if (!chat.isGroupChat && !displayChatName && Array.isArray(chat.participants) && currentUserId) {
      const otherParticipant = chat.participants.find(p => p._id !== currentUserId);
      nameToDisplay = otherParticipant ? otherParticipant.username : "Chat";
  }

  return (
    <button
      onClick={() => onSelectChat(chat._id)}
      className={`flex flex-row items-center p-3 rounded-xl transition duration-150 ease-in-out w-full text-left
                  ${isActive ? 'bg-indigo-600 hover:bg-indigo-700' : 'hover:bg-slate-700'}`}
    >
      <div className="flex items-center justify-center h-10 w-10 min-w-[2.5rem] bg-indigo-400 rounded-full text-white font-semibold overflow-hidden flex-shrink-0">
        {chatAvatar ? (
          <img src={chatAvatar} alt={nameToDisplay || 'C'} className="w-full h-full object-cover" />
        ) : (
          (nameToDisplay || 'C')?.charAt(0).toUpperCase()
        )}
      </div>
      <div className="ml-3 flex-grow overflow-hidden">
        <div className={`font-semibold text-sm ${isActive ? 'text-white' : 'text-slate-200'}`}>
          {nameToDisplay || "Chat"}
        </div>
        <p className={`text-xs truncate ${isActive ? 'text-indigo-100' : 'text-slate-400'}`}>
          {senderPrefix}{lastMessageText}
        </p>
      </div>
      {lastMessageTime && (
        <div className={`text-xs self-start pt-1 ml-2 flex-shrink-0 ${isActive ? 'text-indigo-200' : 'text-slate-500'}`}>
          {lastMessageTime}
        </div>
      )}
    </button>
  );

}

function ChatList() {
  const { user } = useAuth();
  const {
    chats,
    activeChat,
    selectChat,
    isLoadingChats,
    chatError,
    //createOneOnOneChat, //For creating new chats - UI can be added later
    //createGroupChat
  } = useChat();

  if (isLoadingChats && (!chats || chats.length === 0)) {
    return (
      <div className="flex-grow flex items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  if (chatError) {
    return <ErrorMessage message={chatError} />;
  }

  return (
    <div className="flex flex-col mt-8 flex-grow overflow-y-auto pr-2 -mr-2 custom-scrollbar">
      <div className="flex flex-col space-y-1 ">
        {console.log(chats)}
        {chats.length === 0 && !isLoadingChats && (
          <p className="text-slate-400 italic text-center p-4">No chats yet. Start a new conversation!</p>
        )}
        {chats.map((chat) => (
          <ChatListItem
            key={chat._id}
            chat={chat}
            currentUserId={user?.id} // Pass current user's ID safely
            isActive={activeChat?._id === chat._id}
            onSelectChat={selectChat}
          />
        ))}
      </div>
    </div>
  );
}
export default ChatList;