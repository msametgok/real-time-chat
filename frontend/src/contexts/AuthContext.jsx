import React, { createContext, useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import api from "../services/api";
import socketService from "../services/socket";

export const AuthContext = createContext(null);

/** Only the public demo build sets this - see LoginForm. */
const DEMO_ENABLED = import.meta.env.VITE_DEMO_MODE === 'true';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(null);
  const navigate = useNavigate();

  // Fetch user profile and establish auth state (no socket.connect here)
  const fetchUserProfile = useCallback(async (token) => {
    if (!token) {
      setIsAuthenticated(false);
      setUser(null);
      return null;
    }
    try {
      const profileData = await api.getMyProfile(token);
      const userData = { ...profileData, token };
      setUser(userData);
      setIsAuthenticated(true);
      localStorage.setItem("user", JSON.stringify(userData));
      return userData;
    } catch (error) {
      console.error("AuthContext: Failed to fetch user profile", error);
      localStorage.removeItem("user");
      localStorage.removeItem("token");
      setUser(null);
      setIsAuthenticated(false);
      setAuthError("Failed to verify session. Please log in again.");
      // ensure socket is disconnected if somehow connected
      socketService.disconnect();
      return null;
    }
  }, []);

  // Initialize auth from localStorage
  useEffect(() => {
    const initializeAuth = async () => {
      setLoading(true);
      setAuthError(null);
      const stored = localStorage.getItem("user");
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          if (parsed?.token) {
            await fetchUserProfile(parsed.token);
          } else {
            setIsAuthenticated(false);
            setUser(null);
            localStorage.removeItem("user");
          }
        } catch {
          localStorage.removeItem("user");
          setIsAuthenticated(false);
          setUser(null);
        }
      } else {
        setIsAuthenticated(false);
        setUser(null);
      }
      setLoading(false);
    };
    initializeAuth();
  }, [fetchUserProfile]);

  const login = async (email, password) => {
    setLoading(true);
    setAuthError(null);
    try {
      const response = await api.login(email, password);
      if (!response.token) {
        throw new Error("Login response did not include a token");
      }
      localStorage.setItem("token", response.token);
      await fetchUserProfile(response.token);
      navigate("/chat", { replace: true });
    } catch (error) {
      console.error("AuthContext: Login failed", error);
      setAuthError(error.message || "Login failed. Please check your credentials.");
      setIsAuthenticated(false);
      setUser(null);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const register = async (username, email, password) => {
    setLoading(true);
    setAuthError(null);
    try {
      const response = await api.register(username, email, password);
      if (!response.token) {
        throw new Error("Registration response did not include a token");
      }
      localStorage.setItem("token", response.token);
      await fetchUserProfile(response.token);
      navigate("/chat", { replace: true });
    } catch (error) {
      console.error("AuthContext: Registration failed", error);
      setAuthError(error.message || "Registration failed. Please try again");
      setIsAuthenticated(false);
      setUser(null);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  /**
   * Public-demo entry point: the server mints a throwaway guest account with
   * its chats already seeded and returns the same envelope as login, so from
   * here on this is an ordinary session with no demo-specific handling.
   *
   * Deliberately no email/password step. A visitor arriving from a portfolio
   * link will not fill in a registration form to look at a side project.
   */
  const startDemo = async () => {
    setLoading(true);
    setAuthError(null);
    try {
      const response = await api.startDemoSession();
      if (!response.token) {
        throw new Error("Demo response did not include a token");
      }
      localStorage.setItem("token", response.token);
      await fetchUserProfile(response.token);
      navigate("/chat", { replace: true });
    } catch (error) {
      console.error("AuthContext: Demo session failed", error);
      setAuthError(error.message || "Could not start the demo. Please try again.");
      setIsAuthenticated(false);
      setUser(null);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const logout = useCallback(() => {
    setAuthError(null);

    // Demo guests are disposable: ask the server to delete this account and
    // its seeded chats on the way out. Fired BEFORE the token is cleared,
    // since that token is the only thing identifying which guest to remove.
    //
    // Best-effort by design. It is a no-op for a real user, the server answers
    // 200 either way, and anything that never arrives is collected by the
    // server-side sweeper - which is the path most visitors take anyway, since
    // closing a tab fires no request at all.
    if (DEMO_ENABLED && user?.token) {
      api.endDemoSession(user.token).catch(() => {});
    }

    // Notify server (optional)
    api.logout({}).catch(() => {});
    // Disconnect sockets
    socketService.disconnect();
    // Clear client storage
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
    setIsAuthenticated(false);
    navigate('/login', { replace: true });
    // `user` is a dependency now: the demo cleanup above reads its token, and
    // a stale closure would send the previous guest's token or none at all.
  }, [navigate, user]);

  // React to changes in other tabs
  useEffect(() => {
    const handleStorage = (e) => {
      if (e.key === "user") {
        if (e.newValue) {
          try {
            const newUser = JSON.parse(e.newValue);
            if (newUser?.token && (!user || user.token !== newUser.token)) {
              fetchUserProfile(newUser.token);
            }
          } catch {
            logout();
          }
        } else {
          // user removed → logout
          logout();
        }
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [fetchUserProfile, logout, user]);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated,
        loading,
        authError,
        login,
        register,
        startDemo,
        logout,
        fetchUserProfile
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
