import io from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000';

class SocketService {
    constructor() {
        this.socket = null;
        this.isConnected = false;
        this.typingCallback = null;
        this.messageCallback = null;
        this.messagesReadCallback = null;
        this.messageStatusCallback = null;
        this.chatId = null;
    }

    connect(token) {

        return new Promise((resolve, reject) => {

            if (this.isConnected || this.socket?.connected) {
                console.log('Socket already connected or connecting, skipping');
                resolve();
                return;
            }

            this.socket = io(SOCKET_URL, {
                auth: { token },
                reconnection: true,
                reconnectionAttempts: Infinity,
                reconnectionDelay: 5000 // 5s between attempts
            });

            this.socket.on('connect', () => {
                console.log('Connected to server:', this.socket.id);
                this.isConnected = true;
                if (this.chatId) {
                    this.joinChat(this.chatId);
                }
                resolve();
            });

            this.socket.on('connect_error', (error) => {
                console.error('Connection error:', error.message);
                this.isConnected = false;
                reject(error);
            });

            this.socket.on('error', (error) => {
                console.error('Socket error:', error.message);
            });

            this.socket.on('disconnect', () => {
                console.log('Disconnected from server');
                this.isConnected = false;
            });

            this.setupListeners();

        });
    }

    setupListeners() {
        if (this.socket) {
            this.socket.on('typing', (data) => {
            this.typingCallback?.(data);
        });
            this.socket.on('newMessage', (msg) => {
            this.messageCallback?.(msg);
        });
            this.socket.on('messagesRead', (data) => {
            this.messagesReadCallback?.(data);
        });
            this.socket.on('messageStatus', (data) => {
            this.messageStatusCallback?.(data);
        });
        }
    }

    joinChat(chatId) {
        if (this.socket && this.isConnected) {
            console.log('Joining chat:', chatId);
            this.chatId = chatId; // Store chatId
            this.socket.emit('joinChat', chatId);
        } else {
            console.error('Cannot join chat: Socket not connected');
        }
    }

    onJoinChatAck(callback) {
        this.socket?.on('joinChatAck', callback);
    }

    sendMessage(chatId, content) {
        if (this.socket && this.isConnected) {
            console.log('Sending message:', { chatId, content });
            this.socket.emit('sendMessage', { chatId, content });
        } else {
            console.error('Cannot send message: Socket not connected');
        }
    }

    typingStart(chatId) {
        if(this.socket && this.isConnected) {
            this.socket.emit('typingStart', chatId);
        }
    }

    typingStop(chatId) {
        if(this.socket && this.isConnected) {
            this.socket.emit('typingStop', chatId);
        }
    }

    onNewMessage(callback) {
        this.messageCallback = callback; // Store callback
    }

    onTyping(callback) {
        this.typingCallback = callback;
    }

    onMessagesRead(callback) {
        this.messagesReadCallback = callback;
    }
    
    onMessageStatus(callback) {
        this.messageStatusCallback = callback;
    }

    disconnect() {
        if (this.socket) {
            console.log('Disconnecting socket');
            this.socket.disconnect();
            this.socket = null;
            this.isConnected = false;
            this.typingCallback = null;
            this.messageCallback = null;
            this.messagesReadCallback = null;
            this.messageStatusCallback = null;
            this.chatId = null;
        }
    }
}

export default new SocketService();