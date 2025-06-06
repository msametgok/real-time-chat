import React, { createContext, useState, useEffect, useCallback } from "react";
import { useAuth } from "../hooks/useAuth";
import api from "../services/api";
import socketService from "../services/socket";

export const ChatContext = createContext(null);

export const ChatProvider = ({ children }) => {
    const { user, isAuthenticated, loading: authLoading } = useAuth();

    const [chats, setChats] = useState([]); // List of chats
    const [activeChat, setActiveChat] = useState(null); // The full active chat object
    const [messages, setMessages] = useState([]); // Messages for active chat
    const [isLoadingChats, setIsLoadingChats] = useState(false);
    const [isLoadingMessages, setIsLoadingMessages] = useState(false);
    const [chatError, setChatError] = useState(null);
    const [messagesError, setMessagesError] = useState(null);
    const [typingUsers, setTypingUsers] = useState({}); // { chatId: { userId, username } }
    const [messageStatuses, setMessageStatuses] = useState({}); // { messageId: { deliveredToAll, readByAll, individualReadBy: [] } }

    // Fetch chats when user is authenticated
    const fetchChats = useCallback(async () => {
        if (!isAuthenticated || !user?.token) {
            setChats([]); // Clear chats if not authenticated
            return;
        }
        setIsLoadingChats(true);
        setChatError(null);
        try {
            const fetchedChats = await api.getUserChats(user.token);
            setChats(fetchedChats || []); 
        } catch (error) {
            console.log('ChatContext: Failed to fetch chats', error);
            setChatError(error.message || 'Failed to load chats');
            setChats([]); // Clear chats on error
        } finally {
            setIsLoadingChats(false);
        }
    }, [isAuthenticated, user?.token]);

    useEffect(() => {
        if (isAuthenticated && user && !authLoading) {
            fetchChats();
        } else if (!isAuthenticated && !authLoading) {
            // Clear chat state if user logs out or is not authenticated
            setChats([]);
            setActiveChat(null);
            setMessages([]);
            setTypingUsers({});
            setMessageStatuses({});
        }
    }, [isAuthenticated, user, authLoading, fetchChats])

    // Fetch messages for a given chat (cursor-based)
    const fetchMessages = useCallback(async (chatId, beforeTimestamp = null) => {

        if (!isAuthenticated || !user?.token || !chatId) return;
        
        setIsLoadingMessages(true);
        setMessagesError(null);

        try {
            const data = await api.getChatMessages(chatId, user.token, 30, beforeTimestamp);

            setMessages(prevMessages =>
                beforeTimestamp ? [...data.messages, ...prevMessages] : data.messages
            );
        } catch (error) {
            console.log(`ChatContext: Failed to fetch messages for chat ${chatId}`, error);
            setMessagesError(error.message || 'Failed to load messages');
        } finally {
            setIsLoadingMessages(false);
        }
    }, [isAuthenticated, user?.token]);

    // Select a chat to be active
    const selectChat = useCallback(async (chatId) => {
        if (!chatId) {
            setActiveChat(null);
            setMessages([]);
            return;
        }
        if (activeChat?._id === chatId) return; // Already selected
        if (activeChat?._id) {
            socketService.leaveChat(activeChat._id);
        }

        const selected = chats.find(chat => chat._id === chatId);
        setActiveChat(selected || null);
        setMessages([]); // Clear previous messages
        if (selected) {
            await fetchMessages(chatId);
            socketService.joinChat(chatId);
        }
    }, [chats, activeChat?._id, fetchMessages]);

    // Socket event handlers
    useEffect(() => {
        if (!socketService.socket || !isAuthenticated  || !user) {
            return;
        }

        const handleNewMessage = (newMessage) => {
            console.log('ChatContext: New message received', newMessage);
            // Add to messages if it belongs to the active chat
            if (newMessage.chat === activeChat?._id) {
                setMessages(prevMessages => [...prevMessages, newMessage]);
                // Client should emit 'messageDeliveredToClient' after receiving and processing
                socketService.messageDeliveredToClient(newMessage._id, newMessage.chat);
            }
            // Update the latestMessage
            setChats(prevChats => {
                prevChats.map(chat => {
                    chat._id === newMessage.chat
                        ? {...chat, latestMessage: newMessage, updatedAt: newMessage.createdAt}
                        : chat;
                }).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
            })
        }

        const handleTyping = (typingData) => {
            // typingData: { chatId, userId, username, isTyping }
            if (typingData.chatId === activeChat?._id && typingData.userId !== user._id) {
                setTypingUsers(prev => ({
                    ...prev,
                    [typingData.userId]: typingData.isTyping ? { username: typingData.username } : undefined
                }))
            }
        }

        const handleMessagesReadUpdate = (data) => {
          // data : { chatId, reader : { userId, username }, messageIds, messagedReadByAll: [{ messageId, readByAll: true }] }
            console.log("ChatContext: Messages read update received", data);
            if (data.chatId === activeChat?._id) {
                setMessages((prevMessages) =>
                prevMessages.map((msg) => {
                    if (data.messageIds.includes(msg._id)) {
                    console.log(
                        `Message ${msg._id} was read by ${data.reader.username}`
                    );
                    }
                    const readByAllInfo = data.messagesReadByAll.find(
                    (m) => m.messageId === msg._id
                    );
                    if (readByAllInfo) {
                    return { ...msg, isReadByAll: true }; // Simplified update
                    }
                    return msg;
                })
                );
            }
        };

        const handleMessageDeliveryUpdate = (data) => {
            console.log('ChatContext: messageDeliveryUpdate received', data);
            if (data.chatId === activeChat?._id) {
                setMessages(prevMessages => prevMessages.map(msg => {
                    if (msg._id === data.messageId) {
                        return { ...msg, isDeliveredToAll: data.deliveredToAll }; // Simplified update
                    }
                    return msg;
                }));
            }
        };

        // Register listeners
        socketService.onNewMessage(handleNewMessage);
        socketService.onTyping(handleTyping);
        socketService.onMessagesReadUpdate(handleMessagesReadUpdate);
        socketService.onMessageDeliveryUpdate(handleMessageDeliveryUpdate);

        // Cleanup listeners on component  or when socket/auth changes
        return () => {
            socketService.offNewMessage(handleNewMessage);
            socketService.offTyping(handleTyping);
            socketService.offMessagesReadUpdate(handleMessagesReadUpdate);
            socketService.offMessageDeliveryUpdate(handleMessageDeliveryUpdate);
        }
    }, [activeChat?._id, isAuthenticated, user, selectChat]);

    // Function to create a new 1v1 chat
    const createOneOnOneChatAPI = useCallback(async (otherUserId) => {
        if (!isAuthenticated || !user?.token) throw new Error('User not authenticated');
        setIsLoadingChats(true);
        setChatError(null);
        try {
            const data = await api.createOneOnOneChat(otherUserId, user.token);
            await fetchChats(); // Refresh chat list
            selectChat(data.chat._id);
            return data.chat;
        } catch (error) {
            console.log('ChatContext: Failed to create 1v1 chat', error);
            setChatError(error.message || 'Failed to create chat');
            throw error;
        } finally {
            setIsLoadingChats(false);
        }
    }, [isAuthenticated, user?.token, fetchChats, selectChat]);

    // Function to create a new group chat
    const createGroupChatAPI = useCallback(async (chatName, participantIds) => {
        if (!isAuthenticated || !user?.token) throw new Error('User not authenticated');
        setIsLoadingChats(true);
        setChatError(null);
        try {
            const data = await api.createGroupChat(chatName, participantIds, user.token);
            await fetchChats(); // Refresh chat list
            selectChat(data.chat._id);
            return data.chat;

        } catch (error) {
            console.log('ChatContext: Failed to create group chat', error);
            setChatError(error.message || 'Failed to create group chat');
            throw error;
        } finally {
            setIsLoadingChats(false);
        }
    }, [isAuthenticated, user?.token, fetchChats, selectChat]);

    const contextValue = {
        chats,
        activeChat,
        messages,
        isLoadingChats,
        isLoadingMessages,
        chatError,
        messagesError,
        typingUsers,
        messageStatuses,
        fetchChats,
        fetchMessages,
        selectChat,
        createOneOnOneChatAPI,
        createGroupChatAPI,
    }

    return (
        <ChatContext.Provider value={contextValue}>
            {children}
        </ChatContext.Provider>
    )
}
