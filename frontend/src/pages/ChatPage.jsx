import React from 'react';
import { ChatProvider } from '../contexts/ChatContext';
import ChatList from '../components/chat/ChatList';
import ChatWindow from '../components/chat/ChatWindow';
import {useAuth} from '../hooks/useAuth';

function ChatPage() {
  const user = useAuth().user;
  return (
    // ChatProvider wraps the entire chat interface to provide chat-related state and actions
    <ChatProvider>
      <div className="flex h-screen antialiased text-gray-800 bg-slate-900">
        <div className="flex flex-row h-full w-full overflow-x-hidden">
          {/* Sidebar for ChatList */}
          <div className="flex flex-col py-8 pl-6 pr-2 w-64 md:w-80 lg:w-96 bg-slate-800 flex-shrink-0">
            <div className="flex flex-row items-center justify-center h-12 w-full">
              <div className="flex items-center justify-center rounded-2xl text-indigo-400 bg-slate-700 h-10 w-10">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5V16z"></path>
                </svg>
              </div>
              <div className="ml-2 font-bold text-2xl text-white"> Quick Chat</div>
            </div>
            {/* User Profile/Search - We will populate this later */}
            <div className="flex flex-col items-center bg-slate-700 border border-slate-600 mt-4 w-full py-6 px-4 rounded-lg">
              <div className="h-20 w-20 rounded-full border overflow-hidden bg-slate-500">
                {/* Placeholder for user avatar */}
              </div>
              <div className="text-sm font-semibold mt-2 text-white">{user.username}</div>
              <div className="text-xs text-slate-400">{user.onlineStatus}</div>
            </div>
            {/* Chat List Component */}
            <ChatList />
          </div>

          {/* Main Chat Area (ChatWindow) */}
          <ChatWindow />
        </div>
      </div>
    </ChatProvider>
  );
}

export default ChatPage;