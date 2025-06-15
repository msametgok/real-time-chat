import React from "react";
import { Routes, Route, Navigate, Outlet } from "react-router-dom";
import { useAuth } from "./hooks/useAuth";
import LoadingSpinner from "./components/common/LoadingSpinner";

import LoginPage from "./pages/LoginPage";
import RegisterPage from './pages/RegisterPage';
import ChatPage from './pages/ChatPage'; // Main page for chat interface
import NotFoundPage from './pages/NotFoundPage';

import MainLayout from './components/layout/MainLayout'; // For authenticated users (chat interface)
import AuthLayout from './components/layout/AuthLayout'; // For login/register pages


function ProtectedRoute({ children }) {
    const { isAuthenticated, loading } = useAuth();

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <LoadingSpinner /> {/* Using your LoadingSpinner component */}
                <p className="ml-3 text-gray-600">Verifying authentication...</p>
            </div>
    );
    }

    if (!isAuthenticated) {
        return <Navigate to="/login" replace />;
    }

    return children;
}

function App() {
    const { loading: authLoading } = useAuth();

    // Prevents rendering routes until initial auth check is complete
    if (authLoading) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gray-100">
                <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-blue-500"></div>
                <p className="ml-4 text-xl text-gray-700">Initializing Application...</p>
            </div>
        );
    }

    return (
        <Routes>
            {/* Routes for Authentication (Login, Register) - using AuthLayout */}
            <Route element={<AuthLayout><Outlet /></AuthLayout>}>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/register" element={<RegisterPage />} />
            </Route>

            {/* Protected Routes for the Chat Application - using MainLayout */}
            <Route
                path="/chat/*"
                element={
                <ProtectedRoute>
                    <MainLayout>
                        <ChatPage />
                    </MainLayout>
                </ProtectedRoute>
                }
            />

            {/* Default route: redirect to /chat if authenticated, otherwise to /login */}
            <Route
                path="/"
                element={
                    <NavigateToAppropriatePage />
                }
            />

            <Route path="*" element={<NotFoundPage />} />
        </Routes>
    )
}

function NavigateToAppropriatePage() {
    const { isAuthenticated } = useAuth();
    return isAuthenticated ? <Navigate to="/chat" replace /> : <Navigate to="/login" replace />;
}

export default App;