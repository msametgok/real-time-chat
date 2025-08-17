import React, { useEffect, useMemo } from "react";
import { useChat } from '../../hooks/useChat';
import { useAuth } from '../../hooks/useAuth';
import socketService from '../../services/socket'
import ChatWindowHeader from "./ChatWindowHeader";
import MessageList from './MessageList';
import MessageInput from './MessageInput';

// A new component to display the typing indicator
const TypingIndicator = () => {
    const { typingUsers } = useChat();
    const { user } = useAuth();

    // Create a memoized list of users currently typing IN THIS CHAT
    const currentlyTyping = useMemo(() =>
        Object.entries(typingUsers)
            .filter(([userId, typingUser]) => typingUser && userId !== user?._id)
            .map(([, typingUser]) => typingUser.username),
        [typingUsers, user?._id]
    );

    // If no one else is typing, render an empty div to maintain layout space
    if (currentlyTyping.length === 0) {
        return <div className="h-6 px-4"></div>;
    }

    // Build the display text based on who is typing
    let text = '';
    if (currentlyTyping.length === 1) {
        text = `${currentlyTyping[0]} is typing...`;
    } else if (currentlyTyping.length === 2) {
        text = `${currentlyTyping[0]} and ${currentlyTyping[1]} are typing...`;
    } else {
        text = 'Several people are typing...';
    }

    return (
        <div className="h-6 px-4 text-sm text-slate-400 italic animate-pulse">
        {text}
        </div>
    );
};

function ChatWindow() {
    const { activeChat, messages } = useChat();
    const { user } = useAuth();

    useEffect(() => {
        // Check if there's an active chat, a user, and messages to process
        if (!activeChat || !user || messages.length === 0) {
            return;
        }

        // Find all messages in the active chat that were sent by others and that the current user hasn't read yet
        const unreadMessages = messages.filter(msg =>
            msg.sender?._id !== user._id && !msg.readBy?.includes(user._id)
        );

        if (unreadMessages.length > 0) {
            // FIX: Map the array of message objects to an array of message IDs
            const unreadMessageIds = unreadMessages.map(msg => msg._id);
            console.log(`Emitting markMessagesAsRead for ${unreadMessageIds.length} messages...`);
            socketService.markMessagesAsRead(activeChat._id, unreadMessageIds);
        }
    }, [messages, activeChat, user]);

    useEffect(() => {
        if (!activeChat || !user || messages.length === 0) return;

        // For every undelivered message, emit a delivery receipt
        messages.forEach(m => {
            const already = (m.deliveredTo || []).map(d => d.toString());
            if (m.sender?._id !== user._id && !already.includes(user._id)) {
                socketService.messageDeliveredToClient(m._id, activeChat._id);
            }
        });
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
        <div className="flex flex-col flex-auto h-full">
            <div className="flex flex-col flex-auto flex-shrink-0 bg-slate-800 h-full">
                <ChatWindowHeader />
                <MessageList />
                <TypingIndicator /> 
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