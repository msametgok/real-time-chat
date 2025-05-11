import { createContex, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import api from "../services/api";

export const AuthContext = createContex();

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const navigate = useNavigate();
    
    //check for stored token
    useEffect(() => {
        const token = localStorage.getItem("token");
        if (token) {
            setUser({ token });
        }
        setLoading(false);
    }, []);

    //login function
    const login = async (email, password) => {
        try {
            
            const {token} = await api.login(email, password);
            localStorage.setItem("token", token);
            setUser({ token });
            navigate("/chat");
        } catch (error) {
            throw new Error(error.message || "Login failed");
        }
    
    }

    //register function
    const register = async (username, email, password) => {
        try {
            const {token} = await api.register(username, email, password);
            localStorage.setItem("token", token);
            setUser({ token });
            navigate("/chat");
        } catch (error) {
            throw new Error(error.message || "Registration failed");    
        }
    }

    //logout function
    const logout = () => {
        localStorage.removeItem("token");
        setUser(null);
        navigate("/login");
    }

    return (
        <AuthContext.Provider value={{ user, loading, login, register, logout }}>
            {children}
        </AuthContext.Provider>
    );
}

