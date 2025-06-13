import React, {useRef, useEffect, useState, useCallback} from "react";
import {useChat} from "../../hooks/useChat";
import {useAuth} from "../../hooks/useAuth";
import MessageBubble from "./MessageBubble";
import LoadingSpinner from "../common/LoadingSpinner";

function MessageList() {
    const { user } = useAuth();
    const { activeChat, messages, fetchMessages, isLoadingMessages } = useChat();
    const scrollRef = useRef(null); // Reference for the message container div

    // State to track scroll context ONLY for loading older messages
    const [loadingOlder, setLoadingOlder] = useState(false);
    const [prevScrollHeight, setPrevScrollHeight] = useState(null);

    useEffect(() => {
        const scrollEl = scrollRef.current;
        if (!scrollEl) return;

        if (loadingOlder) {
            // Use requestAnimationFrame to wait for DOM update
            requestAnimationFrame(() => {
                const newScrollHeight = scrollEl.scrollHeight;
                const scrollDifference = newScrollHeight - (prevScrollHeight || 0);
                scrollEl.scrollTop = scrollDifference;
                setLoadingOlder(false);
            });
        } else {
            // Only scroll to bottom if user is already near bottom
            const isNearBottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 100;
            if (isNearBottom) {
                scrollEl.scrollTop = scrollEl.scrollHeight;
            }
        }
    }, [messages, loadingOlder, prevScrollHeight]);

    useEffect(() => {
        const scrollEl = scrollRef.current;
        if (!scrollEl) return;

        // Only scroll to bottom when activeChat changes AND messages just loaded
        if (activeChat && messages.length > 0 && !loadingOlder) {
            requestAnimationFrame(() => {
                scrollEl.scrollTop = scrollEl.scrollHeight;
            });
        }
    }, [activeChat?._id, messages.length]);

    // This handler triggers fetching of older messages.
    const handleScroll = useCallback(async () => {
        const scrollEl = scrollRef.current;
        // Trigger when user scrolls to the top and we are not already loading.
        if (scrollEl && scrollEl.scrollTop === 0 && !isLoadingMessages) {
        const oldestMessage = messages[0];
        if (oldestMessage) {
            console.log('Reached top of scroll, fetching older messages...');
            // Before fetching, set our state to indicate we are loading older messages
            // and save the current scroll height.
            setLoadingOlder(true);
            setPrevScrollHeight(scrollEl.scrollHeight);
            await fetchMessages(activeChat._id, oldestMessage.createdAt);
        }
        }
    }, [isLoadingMessages, messages, activeChat, fetchMessages]);

    return (
        <div
        id="messages-container"
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex flex-col flex-grow p-3 overflow-y-auto custom-scrollbar"
        >
        {/* Show a spinner at the top when loading older messages */}
        {isLoadingMessages && loadingOlder && (
            <div className="flex justify-center py-2">
            <LoadingSpinner />
            </div>
        )}

        <div className="space-y-1">
            {messages.map((message, index) => {
            const previousMessage = messages[index - 1];
            const isOwnMessage = user && message.sender?._id === user._id;
            const showSenderInfo =
                activeChat?.isGroupChat &&
                !isOwnMessage &&
                (!previousMessage || previousMessage.sender?._id !== message.sender?._id);
            
            return (
                <MessageBubble
                key={message._id || `msg-${index}`}
                message={message}
                isOwnMessage={isOwnMessage}
                showSenderInfo={showSenderInfo}
                />
            );
            })}
        </div>
        </div>
    );
}

export default MessageList;