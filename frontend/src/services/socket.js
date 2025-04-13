import io from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000';

class SocketService {
    constructor() {
        this.socket = null;
        this.isConnected = false;
    }

    connect(token) {
        if (this.isConnected || this.socket?.connected) {
            console.log('Socket already connected or connecting, skipping');
            return;
        }
        console.log('Connecting with token:', token);
        this.socket = io(SOCKET_URL, {
            auth: { token },
            reconnection: false // Disable auto-reconnect for debugging
        });

        this.socket.on('connect', () => {
            console.log('Connected to server:', this.socket.id);
            this.isConnected = true;
        });

        this.socket.on('connect_error', (error) => {
            console.error('Connection error:', error.message);
            this.isConnected = false;
        });

        this.socket.on('error', (error) => {
            console.error('Socket error:', error.message);
        });

        this.socket.on('disconnect', () => {
            console.log('Disconnected from server');
            this.isConnected = false;
        });
    }

    joinChat(chatId) {
        if (this.socket && this.isConnected) {
            console.log('Joining chat:', chatId);
            this.socket.emit('joinChat', chatId);
        } else {
            console.error('Cannot join chat: Socket not connected');
        }
    }

    sendMessage(chatId, content) {
        if (this.socket && this.isConnected) {
            console.log('Sending message:', { chatId, content });
            this.socket.emit('sendMessage', { chatId, content });
        } else {
            console.error('Cannot send message: Socket not connected');
        }
    }

    onNewMessage(callback) {
        if (this.socket) {
            this.socket.on('newMessage', (msg) => {
                console.log('Received new message:', msg);
                callback(msg);
            });
        } else {
            console.error('Cannot listen for messages: Socket not initialized');
        }
    }

    disconnect() {
        if (this.socket) {
            console.log('Disconnecting socket');
            this.socket.disconnect();
            this.socket = null;
            this.isConnected = false;
        }
    }
}

export default new SocketService();