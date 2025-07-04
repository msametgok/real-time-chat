// src/contexts/ChatContext.jsx

import React, {
  createContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import { useAuth } from "../hooks/useAuth";
import api from "../services/api";
import socketService from "../services/socket";
import useCleanSocketDisconnect from '../hooks/useCleanSocketDisconnect';

export const ChatContext = createContext(null);

// Helper to clone and compute delivered/read statuses
const calculateAndApplyStatus = (msg, chat) => {
  const message = { ...msg };
  if (!chat?.participants || !message?.sender) {
    message.deliveredToAll = false;
    message.isReadByAll = false;
    return message;
  }
  const senderId = message.sender._id || message.sender;
  const others = chat.participants.filter(
    p => p._id.toString() !== senderId.toString()
  );
  if (others.length === 0) {
    message.deliveredToAll = true;
    message.isReadByAll = true;
    return message;
  }
  message.deliveredToAll = others.every(p =>
    message.deliveredTo?.some(id => id.toString() === p._id.toString())
  );
  message.isReadByAll = others.every(p =>
    message.readBy?.some(id => id.toString() === p._id.toString())
  );
  return message;
};

export function ChatProvider({ children }) {
  useCleanSocketDisconnect();
  const { user, isAuthenticated, loading: authLoading } = useAuth();

  // Presence state
  const [presence, setPresence] = useState({});

  const handleUserStatusUpdate = useCallback(
    ({ userId, onlineStatus, lastSeen }) => {
      setPresence(prev => ({
        ...prev,
        [userId]: { onlineStatus, lastSeen }
      }));
    },
    []
  );

  useEffect(() => {
    if (!isAuthenticated) return;
    socketService.onUserStatusUpdate(handleUserStatusUpdate);
    return () => {
      socketService.offUserStatusUpdate(handleUserStatusUpdate);
    };
  }, [isAuthenticated, handleUserStatusUpdate]);

  // Core state
  const [chats, setChats] = useState([]);
  const [activeChat, setActiveChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [isLoadingChats, setIsLoadingChats] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [chatError, setChatError] = useState(null);
  const [messagesError, setMessagesError] = useState(null);
  const [typingUsers, setTypingUsers] = useState({});
  const [hasConnected, setHasConnected] = useState(false);

  // 1) Fetch all chats
  const fetchChats = useCallback(async () => {
    if (!isAuthenticated || !user?.token) {
      setChats([]);
      return;
    }
    setIsLoadingChats(true);
    setChatError(null);
    try {
      const fetched = await api.getUserChats(user.token);
      const normalized = (fetched || []).map(c => ({
        ...c,
        updatedAt:
          c.latestMessage?.createdAt || c.updatedAt || new Date().toISOString(),
        unreadCount: c.unreadCount || 0
      }));
      setChats(normalized);
    } catch (err) {
      console.error("ChatContext: fetchChats error", err);
      setChatError(err.message || "Failed to load chats");
      setChats([]);
    } finally {
      setIsLoadingChats(false);
    }
  }, [isAuthenticated, user?.token]);

  // On login/logout: load or clear
  useEffect(() => {
    if (isAuthenticated && user && !authLoading) {
      fetchChats();
    } else if (!isAuthenticated && !authLoading) {
      setChats([]);
      setActiveChat(null);
      setMessages([]);
      setTypingUsers({});
      setPresence({});
    }
  }, [isAuthenticated, authLoading, user, fetchChats]);

  // 2) Fetch messages for a chat
  const fetchMessages = useCallback(
    async (chatId, beforeTimestamp = null) => {
      if (!isAuthenticated || !user?.token || !chatId) return;
      setIsLoadingMessages(true);
      setMessagesError(null);
      try {
        const data = await api.getChatMessages(
          chatId,
          user.token,
          30,
          beforeTimestamp
        );
        const currentChat = chats.find(c => c._id === chatId);
        const withStatus = data.messages.map(m =>
          calculateAndApplyStatus(m, currentChat)
        );
        const sorted = withStatus.reverse();
        setMessages(prev =>
          beforeTimestamp ? [...sorted, ...prev] : sorted
        );
      } catch (err) {
        console.error(`ChatContext: fetchMessages error for ${chatId}`, err);
        setMessagesError(err.message || "Failed to load messages");
      } finally {
        setIsLoadingMessages(false);
      }
    },
    [isAuthenticated, user?.token, chats]
  );

  // 3) Select a chat
  const selectChat = useCallback(
    async chatId => {
      if (activeChat?._id === chatId) return;
      
      const sel = chats.find(c => c._id === chatId) || null;
      setActiveChat(sel);
      setMessages([]);
      if (sel) {
        await fetchMessages(chatId);
      }
    },
    [activeChat?._id, chats, fetchMessages]
  );

  // ─── 4) REAL-TIME HANDLERS ───

  // New message arrives
  const handleNewMessage = useCallback(
    newMessage => {
      if (isAuthenticated && user?._id !== newMessage.sender?._id && !newMessage.deliveredTo?.includes(user._id)) {
        socketService.messageDeliveredToClient(
          newMessage._id,
          newMessage.chat
        );
      }
      if (newMessage.chat === activeChat?._id) {
        setMessages(prev => {
          // If it was already added via optimistic render (tempId), replace it
          const tempIndex = prev.findIndex(m => m._id === newMessage.tempId);
          if (tempIndex !== -1) {
            const updated = [...prev];
            updated[tempIndex] = newMessage;
            return updated;
          }

          // Else: normal append if not duplicate
          const exists = prev.some(m => m._id === newMessage._id);
          if (exists) return prev;
          return [...prev, newMessage];
        });
    }
      setChats(prev =>
        prev
          .map(c => {
            if (c._id === newMessage.chat) {
              const isActive = c._id === activeChat?._id;
              return {
                ...c,
                latestMessage: newMessage,
                updatedAt: newMessage.createdAt,
                unreadCount: isActive ? 0 : (c.unreadCount || 0) + 1
              };
            }
            return c;
          })
          .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
      );
    },
    [activeChat?._id, user?._id]
  );

  // Typing indicators
  const handleTyping = useCallback(
    ({ chatId, userId, username, isTyping }) => {
      if (chatId === activeChat?._id && userId !== user?._id) {
        setTypingUsers(prev => {
          const next = { ...prev };
          if (isTyping) next[userId] = { username };
          else delete next[userId];
          return next;
        });
      }
    },
    [activeChat?._id, user?._id]
  );

  // Read receipts
  const handleMessagesReadUpdate = useCallback(
    ({ chatId, reader, messageIds, messagesReadByAll }) => {
      setMessages(prev =>
        prev.map(msg => {
          if (messageIds.includes(msg._id)) {
            const nowReadAll = messagesReadByAll.includes(msg._id);
            return {
              ...msg,
              readBy: Array.from(new Set([...(msg.readBy || []), reader.userId])),
              isReadByAll: nowReadAll
            };
          }
          return msg;
        })
      );
      setChats(prev =>
        prev.map(c => {
          if (c._id === chatId) {
            const isActive = c._id === activeChat?._id;
            return {
              ...c,
              updatedAt: new Date().toISOString(),
              unreadCount: isActive ? 0 : (c.unreadCount || 0)
            };
          }
          return c;
        })
      );
    },
    [activeChat?._id]
  );

  // Delivery receipts
const handleMessageDeliveryUpdate = useCallback(
  ({ chatId, messageId, deliveredToUserId, deliveredToAll }) => {
    setMessages(prev =>
      prev.map(msg => {
        if (msg._id === messageId) {
          const newDelivered = Array.from(
            new Set([...(msg.deliveredTo || []), deliveredToUserId])
          );

          // 💡 RECOMPUTE MESSAGE STATUS
          const updatedMsg = {
            ...msg,
            deliveredTo: newDelivered,
            deliveredToAll,
          };

          const chat = chats.find(c => c._id === chatId);
          return calculateAndApplyStatus(updatedMsg, chat);
        }
        return msg;
      })
    );

    // Optional: update chat preview timestamp
    setChats(prev =>
      prev.map(c => {
        if (c._id === chatId) {
          return { ...c, updatedAt: new Date().toISOString() };
        }
        return c;
      })
    );
  },
  [chats]
);

  // Sidebar chat-list update
  const handleChatListUpdate = useCallback(
    ({ chatId, latestMessage, timestamp }) => {
      setChats(prev =>
        prev
          .map(c => {
            if (c._id === chatId) {
              const isActive = c._id === activeChat?._id;
              return {
                ...c,
                latestMessage: latestMessage || c.latestMessage,
                updatedAt: timestamp,
                unreadCount: isActive ? 0 : (c.unreadCount || 0) + 1
              };
            }
            return c;
          })
          .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
      );
    },
    [activeChat?._id]
  );

  // ─── 4.5) USER CONNECTED TO CHAT (catch-up when someone comes online) ───
  const handleUserConnectedToChat = useCallback(
    ({ chatId, userId }) => {
      if (
        !activeChat ||
        chatId !== activeChat._id ||
        userId === user?._id
      ) {
        return;
      }
      messages.forEach(m => {
        if (
          m.sender?._id !== user?._id &&
          !(m.deliveredTo || []).some(id => id.toString() === user._id)
        ) {
          socketService.messageDeliveredToClient(m._id, chatId);
        }
      });
    },
    [activeChat, messages, user?._id]
  );

  // ─── 5) REGISTER HANDLERS ───
  useEffect(() => {
    if (!isAuthenticated) return;

    socketService.onNewMessage(handleNewMessage);
    socketService.onTyping(handleTyping);
    socketService.onMessagesReadUpdate(handleMessagesReadUpdate);
    socketService.onMessageDeliveryUpdate(handleMessageDeliveryUpdate);
    socketService.onChatListUpdate(handleChatListUpdate);
    socketService.onUserConnectedToChat(handleUserConnectedToChat);

    return () => {
      socketService.offNewMessage(handleNewMessage);
      socketService.offTyping(handleTyping);
      socketService.offMessagesReadUpdate(handleMessagesReadUpdate);
      socketService.offMessageDeliveryUpdate(handleMessageDeliveryUpdate);
      socketService.offChatListUpdate(handleChatListUpdate);
      socketService.offUserConnectedToChat(handleUserConnectedToChat);
    };
  }, [
    isAuthenticated,
    handleNewMessage,
    handleTyping,
    handleMessagesReadUpdate,
    handleMessageDeliveryUpdate,
    handleChatListUpdate,
    handleUserConnectedToChat,
  ]);

  // ─── 6) CONNECT/DISCONNECT SOCKET ───
  useEffect(() => {
    if (isAuthenticated && user?.token && !hasConnected) {
      socketService
        .connect(user.token)
        .then(() => {
          console.log("🔌 Socket connected (ChatProvider)");
          setHasConnected(true);
        })
        .catch(err => {
          console.error("Socket connect failed:", err);
        });
    }
    if (!isAuthenticated && hasConnected) {
      socketService.disconnect();
      setHasConnected(false);
    }
  }, [isAuthenticated, user?.token, hasConnected]);

  // ─── 6.5) JOIN ALL CHATS ON CONNECT ───
  useEffect(() => {
    if (!hasConnected || chats.length === 0) return;

    chats.forEach(c => {
      socketService.joinChat(c._id);
    });

    return () => {
      chats.forEach(c => {
        socketService.leaveChat(c._id);
      });
    };
  }, [hasConnected, chats]);

  // ─── 7) CATCH-UP: latestMessage in every chat ───
  useEffect(() => {
    if (!hasConnected) return;
    chats.forEach(c => {
      const m = c.latestMessage;
      if (
        m &&
        m.sender?._id !== user?._id &&
        !(m.deliveredTo || []).map(d => d.toString()).includes(user?._id)
      ) {
        socketService.messageDeliveredToClient(m._id, c._id);
      }
    });
  }, [hasConnected, chats, user]);

  // ─── 8) CATCH-UP: all messages in the activeChat ───
  useEffect(() => {
    if (!hasConnected || !activeChat) return;
    messages.forEach(m => {
      if (
        m.sender?._id !== user?._id &&
        !(m.deliveredTo || []).map(d => d.toString()).includes(user?._id)
      ) {
        socketService.messageDeliveredToClient(m._id, activeChat._id);
      }
    });
  }, [hasConnected, activeChat, messages, user]);

  // ─── 9) Chat creation helpers ───
  const createOneOnOneChatAPI = useCallback(
    async otherUserId => {
      if (!isAuthenticated || !user?.token)
        throw new Error("User not authenticated");
      setIsLoadingChats(true);
      setChatError(null);
      try {
        const data = await api.createOneOnOneChat(otherUserId, user.token);
        await fetchChats();
        await selectChat(data.chat._id);
        return data.chat;
      } catch (err) {
        console.error("ChatContext: createOneOnOneChat error", err);
        setChatError(err.message || "Failed to create chat");
        throw err;
      } finally {
        setIsLoadingChats(false);
      }
    },
    [isAuthenticated, user?.token, fetchChats, selectChat]
  );

  const createGroupChatAPI = useCallback(
    async (chatName, participantIds) => {
      if (!isAuthenticated || !user?.token)
        throw new Error("User not authenticated");
      setIsLoadingChats(true);
      setChatError(null);
      try {
        const data = await api.createGroupChat(
          chatName,
          participantIds,
          user.token
        );
        await fetchChats();
        await selectChat(data.chat._id);
        return data.chat;
      } catch (err) {
        console.error("ChatContext: createGroupChat error", err);
        setChatError(err.message || "Failed to create group chat");
        throw err;
      } finally {
        setIsLoadingChats(false);
      }
    },
    [isAuthenticated, user?.token, fetchChats, selectChat]
  );

  const contextValue = {
    chats,
    activeChat,
    messages,
    isLoadingChats,
    isLoadingMessages,
    chatError,
    messagesError,
    typingUsers,
    fetchChats,
    fetchMessages,
    selectChat,
    createOneOnOneChatAPI,
    createGroupChatAPI,
    hasConnected,
    presence
  };

  return (
    <ChatContext.Provider value={contextValue}>
      {children}
    </ChatContext.Provider>
  );
}
