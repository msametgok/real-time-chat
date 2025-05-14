import { createContext, useState, useEffect } from "react";
import { useAuth } from "../hooks/useAuth";
import api from "../services/api";

export const ChatContext = createContext();

export const ChatProvider = ({ children }) => {
    const { user, loading: authLoading } = useAuth();
    const [chats, setChats] = useState([]); // List of chats
    const [activeChatId, setActiveChatId] = useState(null); // ID of the selected chat
    const [messages, setMessages] = useState([]); // Messages for active chat
    const [loading, setLoading] = useState(false); // Loading state for API calls
    const [error, setError] = useState(''); // Error state for API failures

    // Fetch chats when user is authenticated
    useEffect(() => {
        if (user && !authLoading) {
            fetchChats();
        }
    }, [user, authLoading]);

    // Fetch messages when activeChatId changes
    useEffect(() => {
        if (activeChatId) {
            fetchMessages(activeChatId);
        }
    }, [activeChatId]);

    const fetchChats = async () => {
        setLoading(true);
        setError('');
        try {
            const data = await api.getChats(user.token);
            setChats(data);
            // Optionally set the first chat as active
            if (data.length > 0 && !activeChatId) {
                setActiveChatId(data[0]._id);
            }
        } catch (error) {
            setError(error.message || 'Failed to fetch chats');
        } finally {
            setLoading(false);
        }
    }

    const fetchMessages = async (chatId) => {
        setLoading(true);
        setError('');
        try {
            const data = await api.getMessages(chatId, user.token);
            setMessages(data);
        } catch (error) {
            setError(error.message || 'Failed to fetch messages');
        } finally {
            setLoading(false);
        }
    }

    // Select a chat and reset messages
    const selectChat = (chatId) => {
        setActiveChatId(chatId);
        setMessages([]);
    }

    //Create a new chat
    const createChat = async (participantIds) => {
        setLoading(true);
        setError('');
        try {
            const {chatId} = await api.createChat(participantIds, user.token);
            await fetchChats(); 
            setActiveChatId(chatId); 
        } catch (error) {
            setError(error.message || 'Failed to create chat');
            throw error;
        } finally {
            setLoading(false);
        }
    }

    return (
        <ChatContext.Provider value={{
            chats,
            activeChatId,
            messages,
            loading,
            error,
            fetchChats,
            selectChat,
            fetchMessages,
            createChat
        }}>
            {children}
        </ChatContext.Provider>
    )

}