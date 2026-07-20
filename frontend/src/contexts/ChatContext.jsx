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

/**
 * Newest chat first. Written out five times before this; every writer of
 * `chats` has to re-sort, since any of them can change updatedAt.
 */
const sortChats = chats =>
  [...chats].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

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

  // Same trick for `chats`: fetchMessages only needs it to look up participants
  // for status computation. Taking it as a dependency would recreate
  // fetchMessages (and selectChat with it) on every sidebar change.
  const chatsRef = useRef(chats);
  chatsRef.current = chats;

  // Same again for the open chat, so callbacks can ask "is this the one I'm
  // looking at?" without taking activeChat as a dependency.
  const activeChatRef = useRef(activeChat);
  activeChatRef.current = activeChat;

  const [isLoadingChats, setIsLoadingChats] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [chatError, setChatError] = useState(null);
  const [messagesError, setMessagesError] = useState(null);
  const [typingUsers, setTypingUsers] = useState({});
  const [hasConnected, setHasConnected] = useState(false);

  // Transient realtime failures (chatError / statusError). Separate from
  // `chatError`, which ChatList renders *instead of* the sidebar - routing a
  // one-off socket failure into that state would blank the chat list. This one
  // is a banner: it never replaces content.
  //
  // `key` is bumped on every set so an identical repeated message still
  // restarts the auto-dismiss timer instead of being swallowed as "no change".
  const [realtimeError, setRealtimeError] = useState(null);
  const realtimeErrorKeyRef = useRef(0);

  const raiseRealtimeError = useCallback(message => {
    realtimeErrorKeyRef.current += 1;
    setRealtimeError({ message, key: realtimeErrorKeyRef.current });
  }, []);

  const dismissRealtimeError = useCallback(() => setRealtimeError(null), []);

  // Which chat rooms we believe we have joined. Declared here rather than next
  // to the join effect below because handleChatError has to repair it: a failed
  // join must not leave the id in this set.
  const joinedChatsRef = useRef(new Set());

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
      setChats(sortChats(normalized));
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

  // Monotonic ticket for message fetches. Clicking chat A then B fast leaves
  // two requests in flight; whichever resolves last would win, so A's messages
  // could land in B's window. Only the newest ticket is allowed to write.
  const fetchSeqRef = useRef(0);

  // 2) Fetch messages for a chat
  const fetchMessages = useCallback(
    async (chatId, beforeTimestamp = null) => {
      if (!isAuthenticated || !user?.token || !chatId) return;
      const seq = ++fetchSeqRef.current;
      setIsLoadingMessages(true);
      setMessagesError(null);
      try {
        const data = await api.getChatMessages(
          chatId,
          user.token,
          30,
          beforeTimestamp
        );
        if (fetchSeqRef.current !== seq) return; // superseded - drop the response
        const currentChat = chatsRef.current.find(c => c._id === chatId);
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
        if (fetchSeqRef.current !== seq) return;
        console.error(`ChatContext: fetchMessages error for ${chatId}`, err);
        setMessagesError(err.message || "Failed to load messages");
      } finally {
        // A superseded fetch must not clear the spinner belonging to the one
        // that replaced it.
        if (fetchSeqRef.current === seq) setIsLoadingMessages(false);
      }
    },
    [isAuthenticated, user?.token]
  );

  // 3) Select a chat
  // `chatHint` exists for chats that are not in `chats` yet. Creating a chat
  // calls fetchChats() and then selectChat(), but the setChats from that fetch
  // has not reached this closure by the next line (gotcha 5), so the lookup
  // missed and a brand-new chat opened as `null` - nothing happened. Reading
  // through chatsRef instead of the `chats` closure fixes the common case and
  // drops a dependency; the hint covers the create path outright.
  const selectChat = useCallback(
    async (chatId, chatHint = null) => {
      if (activeChat?._id === chatId) return;

      const sel = chatHint || chatsRef.current.find(c => c._id === chatId) || null;
      setActiveChat(sel);
      setMessages([]);
      // Drop every indicator on switch. A typist who vanished (abrupt
      // disconnect) never sends typingStop, so an entry can outlive the burst;
      // anyone still typing re-announces within ~2s.
      setTypingUsers({});
      if (sel) {
        // Clear the badge on the SERVER, for the whole chat. ChatWindow marks
        // only the page it has loaded, so without this the next fetchChats
        // would recompute a count from messages the user never scrolled back
        // to and the badge would reappear on reload.
        //
        // Emit FIRST and only zero the badge locally if it actually went out.
        // The count now comes from the server, so clearing optimistically on a
        // dropped emit just hides the badge until the next fetch brings it
        // straight back - and the mid-session disconnect window is exactly when
        // someone clicks a chat. Gotcha 10: no optimistic bookkeeping without a
        // repair path. The repair here is the re-emit in the reconnect effect.
        const cleared = socketService.markChatAsRead(chatId);
        if (cleared) {
          // handleNewMessage skips the increment while a chat is active, so
          // this only has to cover what accumulated before the switch.
          setChats(prev =>
            prev.map(c => (c._id === chatId ? { ...c, unreadCount: 0 } : c))
          );
        }
        await fetchMessages(chatId);
      }
    },
    [activeChat?._id, fetchMessages]
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
      sortChats(
        prev.map(c => (c._id === chatId
          ? {...c, latestMessage: optimistic, updatedAt: optimistic.createdAt}
          : c))
      )
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

  // â”€â”€â”€ 4) REAL-TIME HANDLERS â”€â”€â”€
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
        sortChats(
          prev.map((c) => {
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
        )
      );
    },
    [activeChat?._id, user?._id, isAuthenticated]
  );

  // Someone created a chat that includes us. Chat creation is an HTTP call on
  // their side, so this event is the only way we learn about it without a
  // reload. Adding it to `chats` is enough to make the join effect (6.5) put
  // our socket in the new room.
  const handleNewChat = useCallback((chat) => {
    if (!chat?._id) return;

    setChats(prev => {
      if (prev.some(c => c._id === chat._id)) return prev;
      const normalized = {
        ...chat,
        updatedAt:
          chat.latestMessage?.createdAt || chat.updatedAt || new Date().toISOString(),
        unreadCount: chat.unreadCount || 0
      };
      return sortChats([normalized, ...prev]);
    });
  }, []);

  // Typing indicators.
  //
  // Keyed by chatId, then userId. The old shape was keyed by userId alone and
  // gated on `chatId === activeChat._id` - which also swallowed the
  // isTyping:false cleanup, so an indicator raised in chat1 could never be
  // cleared and showed up permanently in chat2. Record every chat's state and
  // let the view filter by the chat it is rendering.
  const handleTyping = useCallback(
    ({ chatId, userId, username, isTyping }) => {
      if (!chatId || !userId || userId === user?._id) return;

      setTypingUsers(prev => {
        const forChat = { ...(prev[chatId] || {}) };
        if (isTyping) forChat[userId] = { username };
        else delete forChat[userId];

        const next = { ...prev };
        if (Object.keys(forChat).length > 0) next[chatId] = forChat;
        else delete next[chatId];
        return next;
      });
    },
    [user?._id]
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

          // ðŸ’¡ RECOMPUTE MESSAGE STATUS
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

  // â”€â”€â”€ 4.5) USER CONNECTED TO CHAT (catch-up when someone comes online) â”€â”€â”€
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
      sortChats(
        prev.map(c => (c._id === message.chat
          ? { ...c, latestMessage: message, updatedAt: message.createdAt }
          : c))
      )
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

  // A joinChat/leaveChat was rejected. Two things have to happen, and the
  // bookkeeping matters more than the message: joinedChatsRef optimistically
  // records the id at emit time, so if we leave a failed join in the set the
  // effect below sees "already joined" and never retries. The room stays
  // unjoined for the whole session and that chat silently receives no realtime
  // updates until a reload. Drop the id so the next chats change re-attempts.
  const handleChatError = useCallback(({ chatId, message }) => {
    if (chatId) joinedChatsRef.current.delete(chatId);
    raiseRealtimeError(message || 'Lost access to a chat. Reconnecting...');
  }, [raiseRealtimeError]);

  // markMessagesAsRead was rejected. Nothing to roll back - read state is owned
  // by the server and we never applied it optimistically - but the user should
  // know their read receipts are not going out.
  const handleStatusError = useCallback(({ message }) => {
    raiseRealtimeError(message || 'Could not update message status.');
  }, [raiseRealtimeError]);

  // â”€â”€â”€ 5) REGISTER HANDLERS â”€â”€â”€
  useEffect(() => {
    if (!isAuthenticated) return;

    socketService.onNewMessage(handleNewMessage);
    socketService.onNewChat(handleNewChat);
    socketService.onTyping(handleTyping);
    socketService.onMessagesReadUpdate(handleMessagesReadUpdate);
    socketService.onMessageDeliveryUpdate(handleMessageDeliveryUpdate);
    socketService.onUserConnectedToChat(handleUserConnectedToChat);
    socketService.onMessageSentAck(handleMessageSentAck);
    socketService.onMessageError(handleMessageError);
    socketService.onChatError(handleChatError);
    socketService.onStatusError(handleStatusError);

    return () => {
      socketService.offNewMessage(handleNewMessage);
      socketService.offNewChat(handleNewChat);
      socketService.offTyping(handleTyping);
      socketService.offMessagesReadUpdate(handleMessagesReadUpdate);
      socketService.offMessageDeliveryUpdate(handleMessageDeliveryUpdate);
      socketService.offUserConnectedToChat(handleUserConnectedToChat);
      socketService.offMessageSentAck(handleMessageSentAck);
      socketService.offMessageError(handleMessageError);
      socketService.offChatError(handleChatError);
      socketService.offStatusError(handleStatusError);
    };
  }, [
    isAuthenticated,
    handleNewMessage,
    handleNewChat,
    handleTyping,
    handleMessagesReadUpdate,
    handleMessageDeliveryUpdate,
    handleUserConnectedToChat,
    handleMessageSentAck,
    handleMessageError,
    handleChatError,
    handleStatusError
  ]);

  // â”€â”€â”€ 6) CONNECT/DISCONNECT SOCKET â”€â”€â”€
  //
  // A rejected connect used to be logged and then dropped: hasConnected stayed
  // false, nothing re-tried, and the app sat in a permanently disconnected
  // state that looked identical to an idle one. Now the failure is retried with
  // backoff and exposed as `connectionError` so the UI can say something.
  const [connectAttempt, setConnectAttempt] = useState(0);
  const [connectionError, setConnectionError] = useState(null);

  useEffect(() => {
    if (!isAuthenticated && hasConnected) {
      socketService.disconnect();
      setHasConnected(false);
      setConnectionError(null);
      setConnectAttempt(0);
      return;
    }

    if (!(isAuthenticated && user?.token && !hasConnected)) return;

    let cancelled = false;
    let retryTimer = null;

    socketService
      .connect(user.token)
      .then(() => {
        if (cancelled) return;
        setHasConnected(true);
        setConnectionError(null);
        setConnectAttempt(0);
      })
      .catch(err => {
        if (cancelled) return;
        setConnectionError(err?.message || 'Could not connect to the server.');

        // 3s, 6s, 12s, 24s, then every 30s. Bounded so a long outage doesn't
        // turn into an unbounded stream of connection attempts.
        const delay = Math.min(30000, 3000 * 2 ** connectAttempt);
        retryTimer = setTimeout(() => setConnectAttempt(n => n + 1), delay);
      });

    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
    };
  }, [isAuthenticated, user?.token, hasConnected, connectAttempt]);

  // â”€â”€â”€ 6.5) JOIN ALL CHATS ON CONNECT â”€â”€â”€
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


  // â”€â”€â”€ 6.6) ALWAYS RE-JOIN ROOMS AND RESYNC AFTER (RE)CONNECT â”€â”€â”€
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

    // A socket that dies AFTER connecting used to be completely silent: the
    // connect effect is gated on `!hasConnected`, so nothing set an error and
    // the UI looked healthy while every emit was being dropped. Surface it
    // here instead - this listener is attached for the whole session.
    const handleDisconnect = reason => {
      // Our own teardown (logout, unmount) is not an outage.
      if (reason === 'io client disconnect') return;

      if (reason === 'io server disconnect') {
        // Socket.IO does NOT auto-reconnect in this case. Drop back to the
        // connect effect, which owns the retry/backoff loop.
        setHasConnected(false);
        setConnectionError('Disconnected by the server. Reconnecting...');
        return;
      }

      // Everything else is inside socket.io's own retry loop; just say so.
      setConnectionError('Connection lost. Reconnecting...');
    };

    const handleConnect = async () => {
      setConnectionError(null);
      const { chats: currentChats, activeChatId, fetchChats: refetchChats, fetchMessages: refetchMessages } =
        resyncRef.current;

      // Re-join every chat regardless of joinedChatsRef; server will ignore duplicates.
      currentChats.forEach(c => socketService.joinChat(c._id));
      joinedChatsRef.current = new Set(currentChats.map(c => c._id));

      // Repair for a markChatAsRead that was dropped while we were offline:
      // opening a chat during an outage leaves its unread state untouched on
      // the server.
      if (activeChatId) socketService.markChatAsRead(activeChatId);

      // Then pull anything we missed while we were away.
      try {
        await refetchChats?.();

        if (activeChatId) {
          // The refetch races the emit above - they travel over different
          // transports, so the server may answer the HTTP fetch before it
          // handles the socket event and hand back the count we just cleared.
          // The active chat is being read by definition, so pin it to 0 rather
          // than depending on that ordering.
          setChats(prev =>
            prev.map(c => (c._id === activeChatId ? { ...c, unreadCount: 0 } : c))
          );
          await refetchMessages?.(activeChatId);
        }
      } catch (err) {
        console.error('ChatContext: resync after reconnect failed', err);
      }
    };

    sock.on('connect', handleConnect);
    sock.on('disconnect', handleDisconnect);
    return () => {
      sock.off('connect', handleConnect);
      sock.off('disconnect', handleDisconnect);
    };
  }, [hasConnected]);


  // â”€â”€â”€ 7/8) CATCH-UP: report delivery for messages we have but haven't acked â”€â”€â”€
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

  // â”€â”€â”€ 9) Chat creation helpers â”€â”€â”€
  //
  // These deliberately do NOT write to `chatError`: ChatList renders that
  // *instead of* the sidebar, so a failed "create chat" used to blank the chat
  // list. They throw instead, and the caller (NewChatModal) shows the message
  // where the user is actually looking.
  //
  // The created chat is handed to selectChat directly. fetchChats() has only
  // queued its setChats at this point, so a lookup by id would miss the chat
  // that was just made and open nothing (gotcha 5).
  const createOneOnOneChatAPI = useCallback(
    async otherUserId => {
      if (!isAuthenticated || !user?.token)
        throw new Error("User not authenticated");
      setIsLoadingChats(true);
      try {
        // 200 (already existed) and 201 (created) both return { chat } - an
        // existing conversation should just open, not error.
        const data = await api.createOneOnOneChat(otherUserId, user.token);
        await fetchChats();
        await selectChat(data.chat._id, data.chat);
        return data.chat;
      } catch (err) {
        console.error("ChatContext: createOneOnOneChat error", err);
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
      try {
        const data = await api.createGroupChat(
          chatName,
          participantIds,
          user.token
        );
        await fetchChats();
        await selectChat(data.chat._id, data.chat);
        return data.chat;
      } catch (err) {
        console.error("ChatContext: createGroupChat error", err);
        throw err;
      } finally {
        setIsLoadingChats(false);
      }
    },
    [isAuthenticated, user?.token, fetchChats, selectChat]
  );

  // Remove a chat from the sidebar. Soft delete for 1-on-1 (the other person
  // keeps it), leave for a group.
  //
  // The local state is updated only AFTER the server confirms: unlike the
  // unread badge there is no repair path here, and optimistically removing a
  // chat that the server refused would hide a live conversation until the next
  // refetch. Throws so the caller can show the failure - not into `chatError`,
  // which ChatList renders instead of the sidebar.
  const deleteChat = useCallback(
    async chatId => {
      if (!isAuthenticated || !user?.token) throw new Error('User not authenticated');
      if (!chatId) return;

      await api.deleteChat(chatId, user.token);

      setChats(prev => prev.filter(c => c._id !== chatId));

      // Stop listening to a room we are no longer in, and forget the
      // optimistic join bookkeeping so a re-created chat can join cleanly.
      socketService.leaveChat(chatId);
      joinedChatsRef.current.delete(chatId);

      // Only clear the open conversation if it is the one being removed.
      if (activeChatRef.current?._id === chatId) {
        setActiveChat(null);
        setMessages([]);
      }
    },
    [isAuthenticated, user?.token]
  );

  // Thin pass-through so components never handle the token themselves (api.js
  // takes it per call). Throws on failure like the create helpers - the caller
  // owns how to show it.
  const searchUsers = useCallback(
    async (keyword, options) => {
      if (!isAuthenticated || !user?.token) throw new Error('User not authenticated');
      const data = await api.searchUsers(keyword, user.token, options);
      return data?.users || [];
    },
    [isAuthenticated, user?.token]
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
    searchUsers,
    deleteChat,
    hasConnected,
    connectionError,
    realtimeError,
    dismissRealtimeError,
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
