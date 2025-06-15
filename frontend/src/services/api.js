import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

const axiosInstance = axios.create({
    baseURL: API_URL,
    headers: {
        'Content-Type': 'application/json',
    },
    });

const api = {
    /**
     * Generic method to make HTTP requests to the backend.
     * @param {string} endpoint - API endpoint (e.g., '/api/auth/login').
     * @param {string} [method='GET'] - HTTP method (GET, POST, etc.).
     * @param {Object} [data=null] - Request body (JSON).
     * @param {string} [token=null] - JWT token for Authorization header.
     * @returns {Promise<Object>} - Response data.
     * @throws {Error}  If request fails (non-2xx status or network error).
      */

    async request(endpoint, method = 'GET', data = null, token = null) {
        try {
            const config = {
                method,
                url: endpoint,
                data,
                headers: token ? { Authorization: `Bearer ${token}` } : {}
            };

            // Make the request using axios instance
            console.log(`Making ${method} request to ${API_URL}${endpoint}`, {
                data,
                token: token ? '[REDACTED]' : null
            });

            const response = await axiosInstance(config);

            console.log(`Response from ${API_URL}${endpoint}:`, response.data);

            return response.data;

        } catch (error) {
            const errorMessage = error.response?.data?.message || error.message || `HTTP error at ${endpoint}`;
            console.error(`API error at ${method} ${API_URL}${endpoint}:`, errorMessage);
            const errToThrow = new Error(errorMessage);
            errToThrow.response = error.response; 
            throw errToThrow;
        }
    },

    /**
    *Log in a user
    * @param {String} email - User's email
    * @param {String} password - User's password
    * @returns {Promise<Object>} - {message, token}
     */
    async login(email, password) {
        return this.request('/api/auth/login', 'POST', { email, password });
    },

    /**
     * Register a new user
     * @param {String} username - User's username
     * @param {String} email - User's email
     * @param {String} password - User's password\
     * @returns {Promise<Object>} - {message, token}
     */
    async register(username, email, password) {
        return this.request('/api/auth/register', 'POST', { username, email, password });
    },

    /**
     * Get messages for a chat (placeholder for ChatWindow.jsx).
     * @param {string} chatId - Chat ID.
     * @param {string} token - JWT token.
     * @returns {Promise<Object>} - List of messages.
     */
    async getMessages(chatId, token) {
        return this.request(`/api/chat/${chatId}/messages`, 'GET', null, token);
    },

    /**
    * Get current user profile
    * @param {String} token - JWT token
    * @returns {Promise<Object>} - User profile data
    */
    async getCurrentUserProfile(token) {
        return this.request('/api/users/profile', 'GET', null, token);
    },

    /**
     * 
     * @param {String} token 
     * @returns {Promise<Object>} - List of user chats
     */
    async getUserChats(token) {
        return this.request('/api/chat', 'GET', null, token);
    },

    async getChatMessages(chatId, token, limit = 30, beforeTimestamp = null) {
        let endpoint = `/api/chat/${chatId}/messages?limit=${limit}`;
        if (beforeTimestamp) {
            endpoint += `&before=${encodeURIComponent(beforeTimestamp)}`;
        }
        return this.request(endpoint, 'GET', null, token);
    },

    /**
     * Create a new one on one chat
     * @param {string[]} otherUserId - Array of user IDs.
     * @param {string} token - JWT token.
     * @returns {Promise<Object>} - Created one-on-one chat data
     */

    async createOneOnOneChat(otherUserId, token) {
        return this.request('/api/chat/one-on-one', 'POST', { otherUserId }, token);
    },

    /**
     * Create a new group chat
     * @param {string} chatName - Name of the group chat
     * @param {string[]} participantIds - Array of user IDs to add to the group chat
     * @param {string} token - JWT token
     * @returns {Promise<Object>} - Created group chat data
     */

    async createGroupChat(chatName, participantIds, token) {
        return this.request('/api/chat/group', 'POST', { chatName, participantIds }, token);   
    },

};

export default api;