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

            // Deliberately no logging of `data` or `response.data` here. The
            // request body carries the plaintext password on login/register,
            // and responses carry decrypted message content - both ended up in
            // the browser console, where they persist and travel with any
            // screenshot or screen share. The token was redacted; nothing else
            // was. If you need to inspect traffic, use the Network tab, which
            // at least doesn't retain it in the log.
            const response = await axiosInstance(config);

            return response.data;

        } catch (error) {
            const errorMessage = error.response?.data?.message || error.message || `HTTP error at ${endpoint}`;
            // Message only - never the body that caused it.
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
     * Log out a user
     * @param {String} token - JWT token
     * @returns {Promise<Object>} - {message}
    */
    async logout(data = {}) {
        return this.request('/api/auth/logout', 'POST', data, null);
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

    /**
     * Search users by username or email. The server already excludes the
     * caller, so results are always people you could start a chat with.
     * An empty keyword is valid and lists everyone, one page at a time.
     * @param {string} keyword - Partial username or email; '' lists all.
     * @param {string} token - JWT token
     * @param {{limit?: number, page?: number}} [options]
     * @returns {Promise<{users: Array, currentPage: number, totalPages: number, totalResults: number}>}
     */
    /**
     * Remove a chat from your list. For a 1-on-1 this is a per-user soft
     * delete - the other participant keeps the conversation. For a group it
     * means leaving it.
     */
    async deleteChat(chatId, token) {
        return this.request(`/api/chat/${chatId}`, 'DELETE', null, token);
    },

    /** The logged-in user's own profile, including email. */
    async getMyProfile(token) {
        return this.request('/api/users/profile', 'GET', null, token);
    },

    /**
     * Update own profile. Send only the fields being changed; `password`
     * additionally requires `currentPassword`. `avatar` is a URL - pass an
     * empty string to remove it.
     * @returns {Promise<{message: string, user: Object}>}
     */
    async updateMyProfile(updates, token) {
        return this.request('/api/users/profile', 'PUT', updates, token);
    },

    async searchUsers(keyword, token, { limit = 10, page = 1 } = {}) {
        const params = new URLSearchParams({ limit: String(limit), page: String(page) });
        // Only send `keyword` when there is one: the server treats a missing
        // keyword as "list everyone", but validates it when present.
        if (keyword) params.set('keyword', keyword);
        return this.request(`/api/users?${params.toString()}`, 'GET', null, token);
    },

};

export default api;