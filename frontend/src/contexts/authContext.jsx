import React, { createContext, useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import api from "../services/api";
import socketService from "../services/socket";

export const AuthContext = createContext(null);

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [loading, setLoading] = useState(true);
    const [authError, setAuthError] = useState(null);
    const navigate = useNavigate();
    
    // Function to fetch user profile using a token
    const fetchUserProfile = useCallback( async (token) => {
        if (!token) {
            setIsAuthenticated(false);
            setUser(null);
            return null;
        }
        try {
            const profileData = await api.request('/api/users/profile', 'GET', null, token);
            const userData = { ...profileData, token };
            setUser(userData);
            setIsAuthenticated(true);
            localStorage.setItem('user', JSON.stringify(userData));

            socketService.connect(token);
            return userData;
        } catch (error) {
            console.error('AuthContext: Failed to fetch user profile', error);
            localStorage.removeItem('user');
            localStorage.removeItem('token');
            setUser(null);
            setIsAuthenticated(false);
            socketService.disconnect();
            setAuthError('Failed to verify session. Please log in again.');
            return null;
        }
    }, [])

    // Check for stored user data on initial load
    useEffect(() => {
        const initializeAuth = async () => {
            setLoading(true);
            setAuthError(null);
            const storedUserString = localStorage.getItem('user');
            if (storedUserString) {
                try {
                    const storedUser = JSON.parse(storedUserString);
                    if (storedUser && storedUser.token) {
                        await fetchUserProfile(storedUser.token);
                    } else {
                        setIsAuthenticated(false);
                        setUser(null);
                        localStorage.removeItem('user'); 
                    }
                } catch (error) {
                    console.error('AuthContext: Error parsing stored user data', error);
                    localStorage.removeItem('user');
                    setIsAuthenticated(false);
                    setUser(null);
                }
            } else {
                setIsAuthenticated(false);
                setUser(null);
            }
            setLoading(false);
        }
        initializeAuth();
    }, [fetchUserProfile]);

    const login = async (email, password) => {
        setLoading(true);
        setAuthError(null);
        try {
            const response = await api.login(email, password);
            if (response.token)  {
                localStorage.setItem('token', response.token);
                await fetchUserProfile(response.token);
                navigate('/chat', { replace: true });
            } else {
                throw new Error('Login response did not include a token');
            }
        } catch (error) {
            console.error('AuthContext: Login failed', error);
            setAuthError(error.message || 'Login failed. Please check your credentials.');
            setIsAuthenticated(false);
            setUser(null);
            throw error;
        } finally {
            setLoading(false);
        }
    }

    const register = async (username, email, password) => {
        setLoading(true);
        setAuthError(null);
        try {
            const response = await api.register(username, email, password);
            if (response.token) {
                localStorage.setItem('token', response.token);
                await fetchUserProfile(response.token);
                navigate('/chat', { replace: true });
            } else {
                throw new Error('Registration response did not include a token');
            }
        } catch (error) {
            console.error('AuthContext: Registration failed', error);
            setAuthError(error.message || 'Registration failed. Please try again');
            setIsAuthenticated(false);
            setUser(null);
            throw error;
        } finally {
            setLoading(false);
        }
    }

    const logout = useCallback(() => {
        setAuthError(null);
        api.clearToken();
        socketService.disconnect();
        localStorage.removeItem('user');
        localStorage.removeItem('token');
        setUser(null);
        setIsAuthenticated(false);
        navigate('/login', { replace: true });
    }, [navigate]);

    // Re-authenticate if token changes (e.g. from another tab)
useEffect(() => {
    const handleStorageChange = (event) => {

        if (event.key === 'user') { // Listen for changes to our 'user' item
            if (event.newValue) { // If 'user' item is set or changed in another tab
                try {
                const newUserData = JSON.parse(event.newValue);
                if (newUserData && newUserData.token) {
                // If current user is different or not authenticated, update
                    if (!user || user.token !== newUserData.token) {
                    fetchUserProfile(newUserData.token);
                    }
                } else {
                    logout(); // If new value is invalid or no token
                }
                } catch { logout(); } // If parsing fails
            } else { // If 'user' item is removed in another tab (logout)
                logout();
            }
        }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => {
        window.removeEventListener('storage', handleStorageChange);
    };
}, [logout, fetchUserProfile, user]);

    const contextValue = {
        user,
        isAuthenticated,
        loading,
        authError,
        login,
        register,
        logout,
        fetchUserProfile
    }

    return (
        <AuthContext.Provider value={contextValue}>
            {children}
        </AuthContext.Provider>
    );
}

