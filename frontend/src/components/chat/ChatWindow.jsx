import React, { useEffect } from "react";
import { useChat } from '../../hooks/useChat';
import { useAuth } from '../../hooks/useAuth';
import socketService from '../../services/socket'
import ChatWindowHeader from "./ChatWindowHeader";
import MessageList from './MessageList';
import MessageInput from './MessageInput';

function ChatWindow() {
    const { activeChat, messages } = useChat();
    const { user } = useAuth();

    useEffect(() => {
        // Check if there's an active chat, a user, and messages to process
        if (!activeChat || !user || messages.length === 0) {
            return;
        }

        // Find all messages in the active chat that were sent by others and that the current user hasn't read yet
        const unreadMessageIds = messages.filter(msg => 
            msg.sender?.id !== user._id && !msg.readBy?.includes(user._id)
        );

        if (unreadMessageIds.length > 0) {
            console.log(`Emitting markMessagesAsRead for ${unreadMessageIds.length} messages...`);
            // Tell the server that the current user has read them
            socketService.markMessagesAsRead(activeChat._id, unreadMessageIds);
        }
    }, [messages, activeChat, user]);

    const handleSendMessage = (messageContent) => {
        if (!activeChat) return;

        // Construct the message object to send via socket
        const messageData = {
            chatId: activeChat._id,
            messageType: 'text',
            content: messageContent,
            tempId: `temp_${Date.now()}`, // Temporary ID for optimistic UI updates
        }

        socketService.sendMessage(messageData);
    }

    const handleTypingStart = () => {
        if (!activeChat) return;
        socketService.typingStart(activeChat._id);
    }

    const handleTypingStop = () => {
        if (!activeChat) return;
        socketService.typingStop(activeChat._id);
    }

    // View when no chat is selected
    if (!activeChat) {
        return (
            <div className="flex-1 p-4 flex flex-col items-center justify-center bg-slate-900 text-slate-400 h-full">
                <div className="text-center">
                    <svg className="mx-auto h-12 w-12 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                    <h3 className="mt-2 text-sm font-medium text-white">No chat selected</h3>
                    <p className="mt-1 text-sm text-slate-500">Select a chat from the list to start messaging.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col flex-auto h-full p-0 md:p-6 md:pl-0">
            <div className="flex flex-col flex-auto flex-shrink-0 rounded-2xl bg-slate-800 h-full">
                <ChatWindowHeader />
                <MessageList />
                <MessageInput
                onSendMessage={handleSendMessage}
                onTypingStart={handleTypingStart}
                onTypingStop={handleTypingStop}
            />
            </div>
        </div>
    );
}

export default ChatWindow;