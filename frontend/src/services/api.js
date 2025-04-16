import axios from 'axios';

const API_URL = /*port.meta.env.VITE_API_URL ||*/ 'http://localhost:5000';

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
            };

            // Include data for POST/PUT requests
            if (data) {
                config.data = data;
            }

            // Add Authorization header if token is provided
            if (token) {
                config.headers = {
                    Authorization: `Bearer ${token}`,
                };
            }

            // Make the request using axios instance
            console.log(`Making ${method} request to ${API_URL}${endpoint}`, {
                data,
                token: token ? '[REDACTED]' : null
            });

            const response = await axiosInstance(config);

            console.log(`Response from ${API_URL}${endpoint}:`, response.data);

            return response.data;

        } catch (error) {
            const errorMessage = error.response?.data?.message || error.message || 'HHTP error at ${endpoint}';
            console.error(`API error at ${endpoint}:`, errorMessage);
            throw new Error(errorMessage);
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
     * Get user's chats(placeholder for ChatList component)
     * @param {String} token - JWT token
     * @returns {Promise<Object>} - List of chats
     */
    async getChats(chatId, token) {
        return this.request(`/api/chat/${chatId}/messages`, 'GET', null, token);
    },

    /**
     * Create a new chat (placeholder for ChatList.jsx).
     * @param {string[]} participantIds - Array of user IDs.
     * @param {string} token - JWT token.
     * @returns {Promise<Object>} - { message, chatId }.
     */
    async createChat(participantIds, token) {
        return api.request('/api/chat/create', 'POST', { participantIds }, token);
    },

    /**
     * Get messages for a chat (placeholder for ChatWindow.jsx).
     * @param {string} chatId - Chat ID.
     * @param {string} token - JWT token.
     * @returns {Promise<Object>} - List of messages.
     */

    //Bu endpoint uygulamda yok getchats zaten bu işlemi yapıyor.
    async getMessages(chatId, token) {
        return api.request(`/api/message?chatId=${chatId}`, 'GET', null, token);
    }

};

export default api;