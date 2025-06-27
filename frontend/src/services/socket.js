import io from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000';

class SocketService {
  constructor() {
    this.socket = null;
    this.isConnected = false;
    
    // Store one callback per event name
    this.eventCallbacks = {
      newMessage: null,
      typing: null,
      messagesReadUpdate: null,
      messageDeliveryUpdate: null,
      userStatusUpdate: null,
      userConnectedToChat: null,
      userDisconnectedFromChat: null,
      joinChatAck: null,
      leftChatAck: null,
      messageSentAck: null,
      chatError: null,
      messageError: null,
      statusError: null,
      // ← NEW:
      chatListUpdate: null,
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

      this.socket.on('connect', () => {
        this.isConnected = true;
        this.setupDefaultListeners();
        resolve();
      });

      this.socket.on('connect_error', err => {
        this.isConnected = false;
        if (
          err.message === 'Authentication Error: No token provided.' ||
          err.message === 'Authentication Error: Invalid token.'
        ) {
          reject(err);
        }
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
    this.socket.on('typing', data => this.eventCallbacks.typing?.(data));
    this.socket.on('messagesReadUpdate', data => this.eventCallbacks.messagesReadUpdate?.(data));
    this.socket.on('messageDeliveryUpdate', data => this.eventCallbacks.messageDeliveryUpdate?.(data));
    this.socket.on('userStatusUpdate', data => this.eventCallbacks.userStatusUpdate?.(data));
    this.socket.on('userConnectedToChat', data => this.eventCallbacks.userConnectedToChat?.(data));
    this.socket.on('userDisconnectedFromChat', data => this.eventCallbacks.userDisconnectedFromChat?.(data));
    this.socket.on('joinedChat', data => this.eventCallbacks.joinChatAck?.(data));
    this.socket.on('leftChatAck', data => this.eventCallbacks.leftChatAck?.(data));
    this.socket.on('messageSentAck', data => this.eventCallbacks.messageSentAck?.(data));
    this.socket.on('chatError', data => this.eventCallbacks.chatError?.(data));
    this.socket.on('messageError', data => this.eventCallbacks.messageError?.(data));
    this.socket.on('statusError', data => this.eventCallbacks.statusError?.(data));

    // ← NEW: chatListUpdate
    this.socket.on('chatListUpdate', data => this.eventCallbacks.chatListUpdate?.(data));
  }

  // Generic emitter
  emit(eventName, data) {
    if (this.socket && this.socket.connected) {
      try {
        this.socket.emit(eventName, data);
      } catch (err) {
        console.error(`SocketService.emit error on '${eventName}':`, err);
      }
    }
  }

  // ——— Emitter shortcuts ———
  joinChat(chatId) { this.emit('joinChat', { chatId }); }
  leaveChat(chatId) { this.emit('leaveChat', { chatId }); }
  sendMessage(data) { this.emit('sendMessage', data); }
  typingStart(chatId) { this.emit('typingStart', { chatId }); }
  typingStop(chatId) { this.emit('typingStop', { chatId }); }
  markMessagesAsRead(chatId, messageIds) { this.emit('markMessagesAsRead', { chatId, messageIds }); }
  messageDeliveredToClient(messageId, chatId) { this.emit('messageDeliveredToClient', { messageId, chatId }); }

  // ——— Listener registration ———
  _registerListener(event, cb) {
    if (this.eventCallbacks.hasOwnProperty(event)) {
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

  onUserDisconnectedFromChat(cb) { this._registerListener('userDisconnectedFromChat', cb); }
  offUserDisconnectedFromChat(cb) { this._unregisterListener('userDisconnectedFromChat', cb); }

  onJoinChatAck(cb) { this._registerListener('joinChatAck', cb); }
  offJoinChatAck(cb) { this._unregisterListener('joinChatAck', cb); }

  onLeftChatAck(cb) { this._registerListener('leftChatAck', cb); }
  offLeftChatAck(cb) { this._unregisterListener('leftChatAck', cb); }

  onMessageSentAck(cb) { this._registerListener('messageSentAck', cb); }
  offMessageSentAck(cb) { this._unregisterListener('messageSentAck', cb); }

  onChatError(cb) { this._registerListener('chatError', cb); }
  offChatError(cb) { this._unregisterListener('chatError', cb); }

  onMessageError(cb) { this._registerListener('messageError', cb); }
  offMessageError(cb) { this._unregisterListener('messageError', cb); }

  onStatusError(cb) { this._registerListener('statusError', cb); }
  offStatusError(cb) { this._unregisterListener('statusError', cb); }

  // ← NEW listener methods for chatListUpdate:
  onChatListUpdate(cb) { this._registerListener('chatListUpdate', cb); }
  offChatListUpdate(cb) { this._unregisterListener('chatListUpdate', cb); }

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
