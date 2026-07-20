import io from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000';

/**
 * How long to wait for a first connection before giving up on the promise.
 * The socket keeps retrying underneath; this only bounds how long a caller
 * waits before being told something is wrong.
 */
export const CONNECT_TIMEOUT_MS = 15000;

/**
 * Auth failures are fatal - the token is wrong and retrying cannot fix it, so
 * reject immediately instead of making the caller wait out the timeout.
 * Anything else (server down, DNS, transport) is potentially transient and is
 * left to the retry loop until the timeout fires.
 */
const isFatalAuthError = err =>
    typeof err?.message === 'string' && err.message.startsWith('Authentication Error');

class SocketService {
  constructor() {
    this.socket = null;
    this.isConnected = false;
    
    // Store one callback per event name
    this.eventCallbacks = {
      newMessage: null,
      newChat: null,
      typing: null,
      messagesReadUpdate: null,
      messageDeliveryUpdate: null,
      userStatusUpdate: null,
      userConnectedToChat: null,
      messageSentAck: null,
      chatError: null,
      messageError: null,
      statusError: null,
    };
  }

  connect(token) {
    return new Promise((resolve, reject) => {
      if (this.socket && this.socket.connected) {
        resolve();
        return;
      }
      if (this.socket) {
        this.socket.disconnect();
      }

      this.socket = io(SOCKET_URL, {
        auth: { token },
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 3000,
        transports: ['websocket','polling']
      });

      // This promise used to have a path that settled NOTHING: connect_error
      // rejected only on two exact auth strings, so any other failure - server
      // down, DNS, transport blocked, a reworded auth message - left it pending
      // forever. The caller's .then never ran, hasConnected never flipped, and
      // the app sat there looking idle with no error anywhere.
      let settled = false;
      const settle = (fn, arg) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn(arg);
      };

      const timer = setTimeout(
        () => settle(reject, new Error(
          `Could not reach the server within ${CONNECT_TIMEOUT_MS / 1000}s.`
        )),
        CONNECT_TIMEOUT_MS
      );

      this.socket.on('connect', () => {
        this.isConnected = true;
        this.setupDefaultListeners();
        settle(resolve);
      });

      this.socket.on('connect_error', err => {
        this.isConnected = false;
        // Only auth errors are worth failing fast on. Everything else stays in
        // socket.io's retry loop, which may still succeed before the timeout -
        // rejecting on every error would turn a blip into a hard failure.
        if (isFatalAuthError(err)) settle(reject, err);
      });

      this.socket.on('disconnect', () => {
        this.isConnected = false;
      });
    });
  }

  setupDefaultListeners() {
    if (!this.socket) return;
    // Remove previous listeners for these events to avoid double-calls on reconnect
    Object.keys(this.eventCallbacks).forEach(eventName => {
      this.socket.off(eventName);
    });

    // Core event wiring:
    this.socket.on('newMessage', data => this.eventCallbacks.newMessage?.(data));
    this.socket.on('newChat', data => this.eventCallbacks.newChat?.(data));
    this.socket.on('typing', data => this.eventCallbacks.typing?.(data));
    this.socket.on('messagesReadUpdate', data => this.eventCallbacks.messagesReadUpdate?.(data));
    this.socket.on('messageDeliveryUpdate', data => this.eventCallbacks.messageDeliveryUpdate?.(data));
    this.socket.on('userStatusUpdate', data => this.eventCallbacks.userStatusUpdate?.(data));
    this.socket.on('userConnectedToChat', data => this.eventCallbacks.userConnectedToChat?.(data));
    this.socket.on('messageSentAck', data => this.eventCallbacks.messageSentAck?.(data));
    this.socket.on('chatError', data => this.eventCallbacks.chatError?.(data));
    this.socket.on('messageError', data => this.eventCallbacks.messageError?.(data));
    this.socket.on('statusError', data => this.eventCallbacks.statusError?.(data));
  }

  // Generic emitter. Returns whether the event actually went out, so callers
  // that own optimistic UI can fail fast instead of waiting on a reply that
  // will never come.
  emit(eventName, data) {
    if (!this.socket || !this.socket.connected) {
      console.warn(`SocketService: dropped '${eventName}' - socket not connected`);
      return false;
    }
    try {
      this.socket.emit(eventName, data);
      return true;
    } catch (err) {
      console.error(`SocketService.emit error on '${eventName}':`, err);
      return false;
    }
  }

  // ——— Emitter shortcuts ———
  joinChat(chatId) { this.emit('joinChat', { chatId }); }
  leaveChat(chatId) { this.emit('leaveChat', { chatId }); }
  sendMessage(data) { return this.emit('sendMessage', data); }
  typingStart(chatId) { this.emit('typingStart', { chatId }); }
  typingStop(chatId) { this.emit('typingStop', { chatId }); }
  markMessagesAsRead(chatId, messageIds) { this.emit('markMessagesAsRead', { chatId, messageIds }); }
  // Clears the whole chat, including messages older than the loaded page.
  markChatAsRead(chatId) { this.emit('markChatAsRead', { chatId }); }
  messageDeliveredToClient(messageId, chatId) { this.emit('messageDeliveredToClient', { messageId, chatId }); }

  // ——— Listener registration ———
  _registerListener(event, cb) {
    if (Object.prototype.hasOwnProperty.call(this.eventCallbacks, event)) {
      this.eventCallbacks[event] = cb;
    } else {
      console.warn(`Unknown socket event: ${event}`);
    }
  }
  _unregisterListener(event, cb) {
    if (this.eventCallbacks[event] === cb) {
      this.eventCallbacks[event] = null;
    }
  }

  onNewMessage(cb) { this._registerListener('newMessage', cb); }
  offNewMessage(cb) { this._unregisterListener('newMessage', cb); }

  onNewChat(cb) { this._registerListener('newChat', cb); }
  offNewChat(cb) { this._unregisterListener('newChat', cb); }

  onTyping(cb) { this._registerListener('typing', cb); }
  offTyping(cb) { this._unregisterListener('typing', cb); }

  onMessagesReadUpdate(cb) { this._registerListener('messagesReadUpdate', cb); }
  offMessagesReadUpdate(cb) { this._unregisterListener('messagesReadUpdate', cb); }

  onMessageDeliveryUpdate(cb) { this._registerListener('messageDeliveryUpdate', cb); }
  offMessageDeliveryUpdate(cb) { this._unregisterListener('messageDeliveryUpdate', cb); }

  onUserStatusUpdate(cb) { this._registerListener('userStatusUpdate', cb); }
  offUserStatusUpdate(cb) { this._unregisterListener('userStatusUpdate', cb); }

  onUserConnectedToChat(cb) { this._registerListener('userConnectedToChat', cb); }
  offUserConnectedToChat(cb) { this._unregisterListener('userConnectedToChat', cb); }

  onMessageSentAck(cb) { this._registerListener('messageSentAck', cb); }
  offMessageSentAck(cb) { this._unregisterListener('messageSentAck', cb); }

  // All three error channels are consumed by ChatContext. chatError is not
  // only a message: it also repairs joinedChatsRef, which would otherwise keep
  // claiming we are in a room the server refused us.
  onChatError(cb) { this._registerListener('chatError', cb); }
  offChatError(cb) { this._unregisterListener('chatError', cb); }

  onMessageError(cb) { this._registerListener('messageError', cb); }
  offMessageError(cb) { this._unregisterListener('messageError', cb); }

  onStatusError(cb) { this._registerListener('statusError', cb); }
  offStatusError(cb) { this._unregisterListener('statusError', cb); }

  disconnect() {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
    }
    this.isConnected = false;
    Object.keys(this.eventCallbacks).forEach(key => {
      this.eventCallbacks[key] = null;
    });
  }

  getSocket() {
    return this.socket;
  }
}

export default new SocketService();
