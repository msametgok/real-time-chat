import { useEffect, useState, useCallback } from "react";
import socketService from "../services/socket";
import { useAuth } from "./useAuth";

export function useSocket(chatId) {
    const { user } = useAuth();
    const [isConnected, setIsConnected] = useState(false);
    const [newMessage, setNewMessage] = useState(null);
    const [typingUser, setTypingUser] = useState(null);

    // Connect to Socket.io and join chat when user is authenticated
    useEffect(() => {
        if (user && chatId) {
            const setupSocket = async () => {
                try {
                    await socketService.connect(user.token);

                    //Wait for joinChat acknowledgment
                    const joinChatPromise = new Promise((resolve) => {
                        socketService.onJoinChatAck(({ chatId: joinedChatId }) => {
                            console.log('Received joinChatAck:', joinedChatId);
                            if (joinedChatId === chatId) {
                                setIsConnected(true);
                                resolve();
                            }
                        });
                    })

                    socketService.joinChat(chatId);
                    await joinChatPromise;
                } catch (error) {
                    console.error('Socket setup failed:', error);
                }
            }
            setupSocket();


            return () => {
                socketService.disconnect();
                setIsConnected(false);
            }
        }
    }, [user, chatId]);
            
    //Set up event listeners
    useEffect(() => {
        if(!isConnected) return;

        socketService.onNewMessage((msg) => {
            console.log('New message received:', msg);
            setNewMessage(msg);
        });

        socketService.onTyping(({ userId, username, stopped}) => {
            console.log('Typing event:', { userId, username, stopped });
            if (!stopped){
                setTypingUser({ userId, username });
            }  
            else {
                setTypingUser(null);
            }
        })

        return () => {
            socketService.onNewMessage(null);
            socketService.onTyping(null);
        }
    }, [isConnected]);

    // Socket actions
    const sendMessage = useCallback((content) => {
        if(isConnected && chatId) {
            console.log('Sending message:', { chatId, content });
            socketService.sendMessage(chatId, content)
        } else {
            console.error('Cannot send message: Socket not connected or no chatId');
        }
    }, [chatId, isConnected]);

    const markMessagesRead = useCallback(() => {
        if (isConnected && chatId) {
            console.log('Marking messages read:', chatId);
            socketService.markMessagesRead(chatId);
        } else {
            console.error('Cannot mark messages read: Socket not connected or no chatId');
        }
    }, [chatId, isConnected]);

    const typingStart = useCallback(() => {
        if (isConnected && chatId) {
            console.log('Typing start:', chatId);
            socketService.typingStart(chatId);
        } else {
            console.error('Cannot start typing: Socket not connected or no chatId');
        }
    }, [chatId, isConnected]);

    const typingStop = useCallback(() => {
        if (isConnected && chatId) {
            console.log('Typing stop:', chatId);
            socketService.typingStop(chatId);
        } else {
            console.error('Cannot stop typing: Socket not connected or no chatId');
        }
    }, [chatId, isConnected]);

    return {
        isConnected,
        newMessage,
        typingUser,
        sendMessage,
        markMessagesRead,
        typingStart,
        typingStop
    };
    
}