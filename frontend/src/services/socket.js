import io from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000';

class SocketService {
    constructor() {
        this.socket = null;
        this.isConnected = false;
        
        // Store callbacks in an object
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
        }
    }

    connect(token) {

        return new Promise((resolve, reject) => {

            if (this.socket && this.socket.connected) {
                console.log('Socket already connected or connecting, skipping');
                resolve();
                return;
            }

            if (this.socket) {
                this.socket.disconnect();
            }

            console.log('SocketService: Attempting to connect with token');

            this.socket = io(SOCKET_URL, {
                auth: { token },
                reconnection: true,
                reconnectionAttempts: Infinity,
                reconnectionDelay: 3000, // 5s between attempts,
                transports: ['websocket', 'polling']
            });

            this.socket.on('connect', () => {
                console.log('Connected to server:', this.socket.id);
                this.isConnected = true;
                this.setupDefaultListeners();
                resolve();
            });

            this.socket.on('connect_error', (error) => {
                console.error('Connection error:', error.message);
                this.isConnected = false;
                if (error.message === 'Authentication Error: No token provided.' || error.message === 'Authentication Error: Invalid token.') {
                    reject(error);
                }
            });

            this.socket.on('error', (error) => {
                console.error('Socket error:', error.message);
            });

            this.socket.on('disconnect', (reason) => {
                console.log('Disconnected from server. Reason:', reason);
                this.isConnected = false;
            });
        });
    }

    setupDefaultListeners() {
        if (!this.socket) return;

        // General error/ack events from backend socket
        this.socket.on('chatError', (data) => this.eventCallbacks.chatError?.(data));
        this.socket.on('messageError', (data) => this.eventCallbacks.messageError?.(data));
        this.socket.on('statusError', (data) => this.eventCallbacks.statusError?.(data));

        this.socket.on('joinedChat', (data) => this.eventCallbacks.joinChatAck?.(data));
        this.socket.on('leftChatAck', (data) => this.eventCallbacks.leftChatAck?.(data));
        this.socket.on('messageSentAck', (data) => this.eventCallbacks.messageSentAck?.(data));


        // App-specific data events (handled by ChatContext)
        this.socket.on('newMessage', (msg) => this.eventCallbacks.newMessage?.(msg));
        this.socket.on('typing', (data) => this.eventCallbacks.typing?.(data));
        
        // Updated event names to match backend statusEvents.js
        this.socket.on('messagesReadUpdate', (data) => this.eventCallbacks.messagesReadUpdate?.(data));
        this.socket.on('messageDeliveryUpdate', (data) => this.eventCallbacks.messageDeliveryUpdate?.(data));
        
        this.socket.on('userStatusUpdate', (data) => this.eventCallbacks.userStatusUpdate?.(data));
        this.socket.on('userConnectedToChat', (data) => this.eventCallbacks.userConnectedToChat?.(data));
        this.socket.on('userDisconnectedFromChat', (data) => this.eventCallbacks.userDisconnectedFromChat?.(data));
    }
    
    // Emitter Methods
    emit(eventName, data) {
        if(this.socket && this.socket.connected) {
            this.socket.emit(eventName, data);
        } else {
            console.log(`SocketService: Cannot emit event '${eventName}'. Socket not connected.`);
        }
    }

    joinChat(chatId) {
        this.emit('joinChat', {chatId});
    }
    leaveChat(chatId) {
        this.emit('leaveChat', { chatId });
    }
    sendMessage(messageData) {
        this.emit('sendMessage', messageData);
    }
    typingStart(chatId) {
        this.emit('typingStart', { chatId });
    }
    typingStop(chatId) {
        this.emit('typingStop', { chatId });
    }
    markMessagesAsRead(chatId, messageIds) { // Client now sends array of messageIds
        this.emit('markMessagesAsRead', { chatId, messageIds });
    }
    messageDeliveredToClient(messageId, chatId) {
        this.emit('messageDeliveredToClient', { messageId, chatId });
    }

// --- Listener Registration Methods (Setter for callbacks) ---
    _registerListener(eventName, callback) {
        if (Object.prototype.hasOwnProperty.call(this.eventCallbacks, eventName)) {
            this.eventCallbacks[eventName] = callback;
        } else {
            console.warn(`SocketService: Attempted to register listener for unknown event "${eventName}"`);
        }
    }
    
    _unregisterListener(eventName, callback) {
        if (Object.prototype.hasOwnProperty.call(this.eventCallbacks, eventName) && this.eventCallbacks[eventName] === callback) {
            this.eventCallbacks[eventName] = null;
        }
    }

    onNewMessage(callback) { this._registerListener('newMessage', callback); }
    offNewMessage(callback) { this._unregisterListener('newMessage', callback); }

    onTyping(callback) { this._registerListener('typing', callback); }
    offTyping(callback) { this._unregisterListener('typing', callback); }

    onMessagesReadUpdate(callback) { this._registerListener('messagesReadUpdate', callback); }
    offMessagesReadUpdate(callback) { this._unregisterListener('messagesReadUpdate', callback); }
    
    onMessageDeliveryUpdate(callback) { this._registerListener('messageDeliveryUpdate', callback); }
    offMessageDeliveryUpdate(callback) { this._unregisterListener('messageDeliveryUpdate', callback); }

    onUserStatusUpdate(callback) { this._registerListener('userStatusUpdate', callback); }
    offUserStatusUpdate(callback) { this._unregisterListener('userStatusUpdate', callback); }
    
    onUserConnectedToChat(callback) { this._registerListener('userConnectedToChat', callback); }
    offUserConnectedToChat(callback) { this._unregisterListener('userConnectedToChat', callback); }

    onUserDisconnectedFromChat(callback) { this._registerListener('userDisconnectedFromChat', callback); }
    offUserDisconnectedFromChat(callback) { this._unregisterListener('userDisconnectedFromChat', callback); }

    onJoinChatAck(callback) { this._registerListener('joinChatAck', callback); }
    offJoinChatAck(callback) { this._unregisterListener('joinChatAck', callback); }
    
    onLeftChatAck(callback) { this._registerListener('leftChatAck', callback); }
    offLeftChatAck(callback) { this._unregisterListener('leftChatAck', callback); }

    onMessageSentAck(callback) { this._registerListener('messageSentAck', callback); }
    offMessageSentAck(callback) { this._unregisterListener('messageSentAck', callback); }

    // For error events from server
    onChatError(callback) { this._registerListener('chatError', callback); }
    offChatError(callback) { this._unregisterListener('chatError', callback); }
    onMessageError(callback) { this._registerListener('messageError', callback); }
    offMessageError(callback) { this._unregisterListener('messageError', callback); }
    onStatusError(callback) { this._registerListener('statusError', callback); }
    offStatusError(callback) { this._unregisterListener('statusError', callback); }


    disconnect() {
        if (this.socket) {
            console.log('SocketService: Disconnecting socket explicitly.');
            this.socket.disconnect();
        }
        // Reset state more thoroughly on explicit disconnect
        this.isConnected = false;
        for (const key in this.eventCallbacks) {
            if (Object.prototype.hasOwnProperty.call(this.eventCallbacks, key)) {
                this.eventCallbacks[key] = null;
            }
        }
        if (this.socket) {
            this.socket.removeAllListeners(); // Clean up all listeners on the socket instance
            this.socket = null;
        }
    }

    getSocket() {
        return this.socket;
    }
    
}

export default new SocketService();