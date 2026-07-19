// src/contexts/ChatContext.jsx

import React, {
  createContext,
  useState,
  useEffect,
  useCallback,
  useRef
} from "react";
import { useAuth } from "../hooks/useAuth";
import api from "../services/api";
import socketService from "../services/socket";
import useCleanSocketDisconnect from '../hooks/useCleanSocketDisconnect';

// UUID generator (v4)
const makeUUID = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // fallback if crypto.randomUUID not available
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

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

  // Mirror of `messages` for callbacks that need the current value synchronously
  // without taking `messages` as a dependency (which would recreate them on
  // every incoming message).
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
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
      setChats(normalized.sort((a,b) => new Date(b.updatedAt) - new Date(a.updatedAt)));
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
        setMessages(prev => {
          if (beforeTimestamp) return [...sorted, ...prev];

          // A full replace would drop messages that exist only on the client -
          // failed sends and in-flight optimistic bubbles were never persisted,
          // so the server can't return them. Re-append them or the user's text
          // silently vanishes (and any Retry button with it).
          const serverIds = new Set(sorted.map(m => m._id.toString()));
          const pendingLocal = prev.filter(
            m =>
              (m.failed || m.sending) &&
              !serverIds.has(m._id.toString()) &&
              (m.chat ? m.chat.toString() === chatId.toString() : true)
          );
          return pendingLocal.length ? [...sorted, ...pendingLocal] : sorted;
        });
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
        // Opening a chat clears its badge. handleNewMessage skips the increment
        // while a chat is active, so this only has to cover what accumulated
        // before the switch.
        setChats(prev =>
          prev.map(c => (c._id === chatId ? { ...c, unreadCount: 0 } : c))
        );
        await fetchMessages(chatId);
      }
    },
    [activeChat?._id, chats, fetchMessages]
  );

  const sendMessage = useCallback((messageData) => {
    // messageData: { chatId, messageType, content, tempId }
    const chatId = messageData?.chatId;
    const content = messageData?.content;
    const messageType = messageData?.messageType || 'text';
    const tempId = messageData?.tempId || makeUUID();

    if (!isAuthenticated || !user?._id || !chatId || !content?.trim()) return;

    const optimistic = {
      _id: tempId,
      chat: chatId,
      sender : { _id: user._id, username: user.username},
      content,
      messageType,
      createdAt: new Date().toISOString(),
      deliveredTo: [],
      readBy: [user._id],
      sending: true,
      failed: false
    }

    // optimistic push in the open chat
    if (activeChat?._id === chatId) {
      setMessages(prev => [...prev, optimistic]);
    }

    // optimistic sidebar preview + reorder
    setChats(prev =>
      prev
      .map(c => (c._id === chatId
        ? {...c, latestMessage: optimistic, updatedAt: optimistic.createdAt}
        : c))
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
      
    );

    // actual emit - if the socket is down nothing will ever ack this, so mark
    // it failed immediately rather than leaving it spinning.
    const sent = socketService.sendMessage({ chatId, messageType, content, tempId });
    if (!sent) {
      setMessages(prev =>
        prev.map(m => (m._id === tempId ? { ...m, sending: false, failed: true } : m))
      );
      setMessagesError('You appear to be offline. Message not sent.');
    }
  }, [isAuthenticated, user?._id, user?.username, activeChat?._id]);

  // Re-send a message that previously failed. Reuses the SAME tempId so the
  // existing bubble is reconciled by messageSentAck rather than duplicated.
  const retryMessage = useCallback((tempId) => {
    if (!tempId) return;

    // Read from the ref, NOT from inside a setMessages updater: React defers
    // updater functions to render time, so anything captured in one is still
    // unset on the next line.
    const target = messagesRef.current.find(m => m._id === tempId);
    if (!target) return;

    setMessages(prev =>
      prev.map(m => (m._id === tempId ? { ...m, sending: true, failed: false } : m))
    );

    setMessagesError(null);

    const sent = socketService.sendMessage({
      chatId: target.chat,
      messageType: target.messageType || 'text',
      content: target.content,
      tempId
    });

    if (!sent) {
      setMessages(prev =>
        prev.map(m => (m._id === tempId ? { ...m, sending: false, failed: true } : m))
      );
      setMessagesError('Still offline. Message not sent.');
    }
  }, []);

  const typingStart = useCallback((chatId) => {
    if (!chatId) return;
    socketService.typingStart(chatId);
  }, []);

  const typingStop = useCallback((chatId) => {
    if (!chatId) return;
    socketService.typingStop(chatId);
  }, []);

  const markMessagesAsRead = useCallback((chatId, messageIds) => {
    if (!chatId || !Array.isArray(messageIds) || messageIds.length === 0) return;
    socketService.markMessagesAsRead(chatId, messageIds);
  }, []);

  // ─── 4) REAL-TIME HANDLERS ───
 // New message arrives
  const handleNewMessage = useCallback(
    (newMessage) => {
      const fromMe = newMessage.sender?._id?.toString() === user?._id?.toString();

      // If it's from someone else, immediately send delivery receipt if needed
      if (
        isAuthenticated &&
        !fromMe &&
        !newMessage.deliveredTo?.some((id) => id.toString() === user?._id?.toString())
      ) {
        socketService.messageDeliveredToClient(newMessage._id, newMessage.chat);
      }

      if (newMessage.chat === activeChat?._id) {
        // The server no longer broadcasts newMessage back to the sender - they
        // get messageSentAck instead, which carries the tempId and reconciles
        // the optimistic bubble exactly. So there is nothing to match here:
        // append if we don't already have it.
        //
        // The old content-matching fallback scanned backwards for an optimistic
        // bubble with the same text, which rendered two identical messages sent
        // in a row permanently reversed.
        setMessages((prev) => {
          const exists = prev.some((m) => m._id === newMessage._id);
          if (exists) return prev;
          return [...prev, newMessage];
        });
      }

      // Update sidebar preview / unread counters. This is now the single writer
      // for preview, ordering, and unread - chatListUpdate used to also increment
      // here, so each message bumped the count by more than one.
      setChats((prev) =>
        prev
          .map((c) => {
            if (c._id === newMessage.chat) {
              const isActive = c._id === activeChat?._id;

              // Viewing it means it's read; your own sends are never unread.
              let unreadCount = c.unreadCount || 0;
              if (isActive) unreadCount = 0;
              else if (!fromMe) unreadCount += 1;

              return {
                ...c,
                latestMessage: newMessage,
                updatedAt: newMessage.createdAt,
                unreadCount,
              };
            }
            return c;
          })
          .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
      );
    },
    [activeChat?._id, user?._id, isAuthenticated]
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

  // Server confirms a message we sent (replace optimistic temp message)
  const handleMessageSentAck = useCallback(({ tempId, message }) => {
    if (!tempId || !message) return;

    setMessages(prev => {
      const i = prev.findIndex(m => m._id === tempId);
      if (i === -1) return prev;
      const copy = [...prev];
      copy[i] = message;
      return copy;
    });
    setChats(prev =>
      prev
        .map(c => (c._id === message.chat
          ? { ...c, latestMessage: message, updatedAt: message.createdAt }
          : c))
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    );
  }, []);

  // Server rejected or failed a send. The payload carries the tempId so we can
  // find the exact optimistic bubble and mark it failed instead of leaving it
  // spinning forever.
  const handleMessageError = useCallback(({ tempId, message }) => {
    if (tempId) {
      setMessages(prev =>
        prev.map(m =>
          m._id === tempId ? { ...m, sending: false, failed: true } : m
        )
      );
    }
    setMessagesError(message || 'Failed to send message.');
  }, []);

  // ─── 5) REGISTER HANDLERS ───
  useEffect(() => {
    if (!isAuthenticated) return;

    socketService.onNewMessage(handleNewMessage);
    socketService.onTyping(handleTyping);
    socketService.onMessagesReadUpdate(handleMessagesReadUpdate);
    socketService.onMessageDeliveryUpdate(handleMessageDeliveryUpdate);
    socketService.onUserConnectedToChat(handleUserConnectedToChat);
    socketService.onMessageSentAck(handleMessageSentAck);
    socketService.onMessageError(handleMessageError);

    return () => {
      socketService.offNewMessage(handleNewMessage);
      socketService.offTyping(handleTyping);
      socketService.offMessagesReadUpdate(handleMessagesReadUpdate);
      socketService.offMessageDeliveryUpdate(handleMessageDeliveryUpdate);
      socketService.offUserConnectedToChat(handleUserConnectedToChat);
      socketService.offMessageSentAck(handleMessageSentAck);
      socketService.offMessageError(handleMessageError);
    };
  }, [
    isAuthenticated,
    handleNewMessage,
    handleTyping,
    handleMessagesReadUpdate,
    handleMessageDeliveryUpdate,
    handleUserConnectedToChat,
    handleMessageSentAck,
    handleMessageError
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
  const joinedChatsRef = useRef(new Set());

  useEffect(() => {
    if (!hasConnected) return;

    const currentChatIds = new Set(chats.map(c => c._id));
    const joinedChats = joinedChatsRef.current;

    // Join newly added chats
    currentChatIds.forEach(id => {
      if (!joinedChats.has(id)) {
        socketService.joinChat(id);
        joinedChats.add(id);
      }
    });

    // Leave chats that were removed
    joinedChats.forEach(id => {
      if (!currentChatIds.has(id)) {
        socketService.leaveChat(id);
        joinedChats.delete(id);
      }
    });
  }, [hasConnected, chats]);


  // ─── 6.6) ALWAYS RE-JOIN ROOMS AND RESYNC AFTER (RE)CONNECT ───
  // On refresh or network hiccup, the server drops all room memberships for the new socket.id.
  // Our joinedChatsRef still says "we're joined", so 6.5 won't re-emit. Do it explicitly here.
  //
  // Rejoining alone is NOT enough: anything sent while we were disconnected was
  // broadcast to a room we weren't in, and the server's sync only replays tick
  // state - never message content. Without an explicit refetch those messages
  // stay missing until a manual page reload.
  //
  // Everything the listener needs lives in refs so this effect can depend only
  // on `hasConnected`. Depending on `chats`/`activeChat` would tear down and
  // re-register the listener on every incoming message.
  const resyncRef = useRef({ chats: [], activeChatId: null, fetchChats: null, fetchMessages: null });
  resyncRef.current = {
    chats,
    activeChatId: activeChat?._id ?? null,
    fetchChats,
    fetchMessages
  };

  useEffect(() => {
    if (!hasConnected) return;
    const sock = socketService.getSocket();
    if (!sock) return;

    const handleConnect = async () => {
      const { chats: currentChats, activeChatId, fetchChats: refetchChats, fetchMessages: refetchMessages } =
        resyncRef.current;

      // Re-join every chat regardless of joinedChatsRef; server will ignore duplicates.
      currentChats.forEach(c => socketService.joinChat(c._id));
      joinedChatsRef.current = new Set(currentChats.map(c => c._id));

      // Then pull anything we missed while we were away.
      try {
        await refetchChats?.();
        if (activeChatId) await refetchMessages?.(activeChatId);
      } catch (err) {
        console.error('ChatContext: resync after reconnect failed', err);
      }
    };

    sock.on('connect', handleConnect);
    return () => sock.off('connect', handleConnect);
  }, [hasConnected]);


  // ─── 7/8) CATCH-UP: report delivery for messages we have but haven't acked ───
  // These effects depend on `chats`/`messages`, which change on EVERY incoming
  // message, so without a guard they re-emit the whole array each time. Track
  // what we've already reported and only emit for genuinely new message IDs.
  const deliveryAckedRef = useRef(new Set());

  const reportDelivery = useCallback(
    (message, chatId) => {
      if (!message?._id || !chatId) return;
      if (message.sender?._id === user?._id) return;
      if ((message.deliveredTo || []).map(d => d.toString()).includes(user?._id)) return;

      const key = message._id.toString();
      if (deliveryAckedRef.current.has(key)) return;

      deliveryAckedRef.current.add(key);
      socketService.messageDeliveredToClient(message._id, chatId);
    },
    [user?._id]
  );

  // 7) latestMessage in every chat
  useEffect(() => {
    if (!hasConnected) return;
    chats.forEach(c => reportDelivery(c.latestMessage, c._id));
  }, [hasConnected, chats, reportDelivery]);

  // 8) all messages in the activeChat
  useEffect(() => {
    if (!hasConnected || !activeChat) return;
    messages.forEach(m => reportDelivery(m, activeChat._id));
  }, [hasConnected, activeChat, messages, reportDelivery]);

  // The server's 30s Redis claim expires, and a reconnect may mean the server
  // never recorded our earlier acks - clear the local guard so we re-report.
  useEffect(() => {
    if (!hasConnected) deliveryAckedRef.current.clear();
  }, [hasConnected]);

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
    presence,
    sendMessage,
    retryMessage,
    typingStart,
    typingStop,
    markMessagesAsRead
  };

  return (
    <ChatContext.Provider value={contextValue}>
      {children}
    </ChatContext.Provider>
  );
}
