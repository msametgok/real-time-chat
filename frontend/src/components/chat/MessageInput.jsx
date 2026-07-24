import React, { useState, useRef, useEffect } from 'react';

function MessageInput({ onSendMessage, onTypingStart, onTypingStop }) {
    const [inputValue, setInputValue] = useState('');

    // Must be a ref, not a plain `let`: setInputValue re-renders on every
    // keystroke, which would reset a local variable to null and make the
    // clearTimeout below a no-op - leaking a timer per keystroke.
    const typingTimeoutRef = useRef(null);
    const isTypingRef = useRef(false);

    const stopTyping = () => {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
        if (isTypingRef.current) {
            isTypingRef.current = false;
            onTypingStop?.();
        }
    };

    const handleInputChange = (e) => {
        setInputValue(e.target.value);

        // Only announce the start of a typing burst, not every keystroke.
        if (!isTypingRef.current) {
            isTypingRef.current = true;
            onTypingStart?.();
        }

        // Restart the idle countdown.
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(stopTyping, 2000);
    }

    const handleSendMessage = (e) => {
        e.preventDefault();
        const trimmedInput = inputValue.trim();
        if (trimmedInput) {
            onSendMessage(trimmedInput);
            setInputValue(''); // Clear input after sending
            stopTyping();
        }
    }

    // A textarea does not submit its form on Enter the way an input does, so
    // re-create that: Enter sends, Shift+Enter makes a new line.
    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            handleSendMessage(e);
        }
    }

    // Grow the textarea with its content, up to ~4 lines, then scroll inside.
    // Runs on every value change so clearing after a send also collapses it.
    // scrollHeight excludes the border but style.height includes it
    // (border-box), so add the border on or the content sits 2px short and
    // shows a permanent scrollbar. Only allow one once the cap is hit.
    const textareaRef = useRef(null);
    useEffect(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.style.height = 'auto';
        const border = el.offsetHeight - el.clientHeight;
        const fullHeight = el.scrollHeight + border;
        el.style.height = `${Math.min(fullHeight, 120)}px`;
        el.style.overflowY = fullHeight > 120 ? 'auto' : 'hidden';
    }, [inputValue]);

    // Don't leave a pending timer (or a stuck "typing" indicator) behind.
    useEffect(() => () => clearTimeout(typingTimeoutRef.current), []);

    return (
        <div className="border-t-2 border-slate-700 px-4 pt-4 sm:pb-4 pb-2">
            <form onSubmit={handleSendMessage} className="relative flex">
                {/* Placeholder for attachment button. Bottom-aligned (not
                    centered) so it stays on the last line as the textarea grows. */}
                <span className="absolute inset-y-0 flex items-end pb-1 left-0 pl-2">
                <button type="button" className="inline-flex items-center justify-center rounded-full h-10 w-10 transition duration-500 ease-in-out text-slate-400 hover:bg-slate-700">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" className="h-6 w-6">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                    </svg>
                </button>
                </span>
                <textarea
                ref={textareaRef}
                rows={1}
                placeholder="Write your message!"
                className="w-full resize-none overflow-y-hidden custom-scrollbar focus:outline-none focus:placeholder-slate-500 text-slate-300 placeholder-slate-500 bg-slate-700 rounded-3xl py-3 pl-12 pr-14 border border-slate-600 focus:ring-2 focus:ring-indigo-500"
                value={inputValue}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                autoFocus
                />
                <div className="absolute right-0 items-end pb-1 inset-y-0 flex">
                <button type="submit" className="inline-flex items-center justify-center rounded-full h-10 w-10 transition duration-500 ease-in-out text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none mr-2">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-6 w-6 transform rotate-90">
                    <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z"></path>
                    </svg>
                </button>
                </div>
            </form>
        </div>
    );
}

export default MessageInput;