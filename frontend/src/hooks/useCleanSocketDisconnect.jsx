// src/hooks/useCleanSocketDisconnect.jsx
import { useEffect } from 'react';
import socketService from '../services/socket'; // adjust path if needed

export default function useCleanSocketDisconnect() {
    useEffect(() => {
        const handleBeforeUnload = () => {
        // This triggers your server’s disconnect handler via socket.disconnect()
        socketService.disconnect();
        };

        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload);
        };
    }, []);
}
