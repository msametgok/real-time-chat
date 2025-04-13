import React, { useEffect, useState } from 'react';
import socketService from './services/socket';
import { decrypt } from './services/encryption';

const TestSocket = () => {
    const [message, setMessage] = useState('');
    const [received, setReceived] = useState([]);
    const [isSocketConnected, setIsSocketConnected] = useState(false);

    useEffect(() => {
        const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2N2ZiMGIyYjZhZjg3ZTY1NDY0MTQxMmYiLCJpYXQiOjE3NDQ1MDYzMTgsImV4cCI6MTc0NTExMTExOH0.lQjoha-QfjfjpY_zSYOT0ov2VPsIxjhI9vucxWJulH8'; // Paste fresh token here
        const testChatId = '67fb27e7034c4a81cca7a077';
        console.log('Initializing with token:', token);

        socketService.connect(token);

        const handleConnect = () => {
            console.log('Socket connected, joining chat');
            socketService.joinChat(testChatId);
            setIsSocketConnected(true);
        };

        socketService.socket?.on('connect', handleConnect);

        socketService.onNewMessage((msg) => {
            console.log('Raw message:', msg);
            try {
                const decryptedContent = decrypt(msg.content);
                console.log('Decrypted:', decryptedContent);
                setReceived((prev) => [...prev, `${msg.sender.username}: ${decryptedContent}`]);
            } catch (error) {
                console.error('Decryption error:', error);
            }
        });

        return () => {
            console.log('Cleaning up');
            socketService.socket?.off('connect', handleConnect);
            socketService.disconnect();
        };
    }, []);

    const handleSend = () => {
        console.log('Send clicked, message:', message);
        if (message && isSocketConnected) {
            socketService.sendMessage('67fb27e7034c4a81cca7a077', message);
            setMessage('');
        } else {
            console.log('Cannot send: No message or socket not connected');
        }
    };

    return (
        <div>
            <h1>Socket & Encryption Test</h1>
            <input
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Type a message"
            />
            <button onClick={handleSend}>Send</button>
            <h2>Received Messages</h2>
            <ul>
                {received.map((msg, i) => (
                    <li key={i}>{msg}</li>
                ))}
            </ul>
        </div>
    );
};

export default TestSocket;