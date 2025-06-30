import React from 'react';
import { ChatProvider } from '../contexts/ChatContext';
import { useChat } from '../hooks/useChat';
import { useAuth } from '../hooks/useAuth';
import ChatList from '../components/chat/ChatList';
import ChatWindow from '../components/chat/ChatWindow';
import UserProfileCard from '../components/user/UserProfileCard';

// Wraps chat list and window panels inside ChatProvider
function ChatPage() {
  return (
    <ChatProvider>
      <ChatAppContent />
    </ChatProvider>
  );
}

// This component consumes chat context and auth
function ChatAppContent() {
  const { user } = useAuth();
  const { activeChat, presence } = useChat();

  const me = presence[user._id] || {};

  return (
    <div className="flex h-screen antialiased text-gray-800 bg-slate-900">
      {/* Chat List Panel (visible if no activeChat or on md+) */}
      <div
        className={`flex flex-col bg-slate-800 flex-shrink-0 w-full md:w-64 lg:w-80 xl:w-96 py-8 pl-6 pr-2
                    ${activeChat ? 'hidden' : 'flex'} md:flex`}
      >
        <div className="flex items-center justify-center h-12 w-full">
          <div className="flex items-center justify-center rounded-2xl text-indigo-400 bg-slate-700 h-10 w-10">
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5V16z"
              />
            </svg>
          </div>
          <div className="ml-2 font-bold text-2xl text-white whitespace-nowrap">Quick Chat</div>
        </div>

        {/* User Profile Card */}
        <div className="mt-4">
          <UserProfileCard />
          {console.log(`presence ${me.onlineStatus}`)}
        </div>

        <ChatList />
      </div>

      {/* Chat Window Panel (visible if activeChat or on md+) */}
      <div className={`${activeChat ? 'flex' : 'hidden'} flex-auto md:flex`}>
        <ChatWindow />
      </div>
    </div>
  );
}

export default ChatPage;
