import React, { useState } from 'react';

function MessageInput({ onSendMessage, onTypingStart, onTypingStop }) {
    const [inputValue, setInputValue] = useState('');
    let typingTimeout = null;

    const handleInputChange = (e) => {
        setInputValue(e.target.value);

        // Emit typing start event
        if (onTypingStart) {
            onTypingStart();
        }

        // Clear previous timeout and set a new one for typing stop
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
            if (onTypingStop) {
                onTypingStop();
            }
        }, 2000);
    }

    const handleSendMessage = (e) => {
        e.preventDefault();
        const trimmedInput = inputValue.trim();
        if (trimmedInput) {
            onSendMessage(trimmedInput);
            setInputValue(''); // Clear input after sending
            clearTimeout(typingTimeout);
            if (onTypingStop) {
                onTypingStop();
            } 
        }
    }

    return (
        <div className="border-t-2 border-slate-700 px-4 pt-4 sm:pb-4 pb-2">
            <form onSubmit={handleSendMessage} className="relative flex">
                {/* Placeholder for attachment button */}
                <span className="absolute inset-y-0 flex items-center left-0 pl-2">
                <button type="button" className="inline-flex items-center justify-center rounded-full h-10 w-10 transition duration-500 ease-in-out text-slate-400 hover:bg-slate-700">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" className="h-6 w-6">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                    </svg>
                </button>
                </span>
                <input
                type="text"
                placeholder="Write your message!"
                className="w-full focus:outline-none focus:placeholder-slate-500 text-slate-300 placeholder-slate-500 pl-12 bg-slate-700 rounded-full py-3 px-5 border border-slate-600 focus:ring-2 focus:ring-indigo-500"
                value={inputValue}
                onChange={handleInputChange}
                autoFocus
                />
                <div className="absolute right-0 items-center inset-y-0 flex">
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