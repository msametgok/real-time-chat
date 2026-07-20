import React, { useEffect, useRef } from 'react';
import { useChat } from '../../hooks/useChat';

// A thin banner for realtime problems the user can't otherwise see.
//
// Deliberately NOT the same surface as ChatList's `chatError`: that one renders
// instead of the sidebar, which is right for "your chats failed to load" and
// badly wrong for "one join was rejected". This overlays; it never replaces
// content, so a transient socket failure can't blank the app.
function RealtimeNotice() {
    const { connectionError, realtimeError, dismissRealtimeError } = useChat();
    const timerRef = useRef(null);

    // Auto-dismiss the transient errors. Keyed on `realtimeError?.key` rather
    // than the message so a repeat of the same text restarts the countdown
    // instead of leaving a stale banner from the first occurrence.
    useEffect(() => {
        if (!realtimeError) return;

        // A plain `let` here would reset every render and clearTimeout would
        // silently no-op, leaving orphaned timers that dismiss the wrong banner.
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(dismissRealtimeError, 6000);

        return () => clearTimeout(timerRef.current);
    }, [realtimeError?.key, dismissRealtimeError]);

    // A dead socket outranks a one-off rejection: if we're not connected, the
    // rejection is almost certainly a symptom of it.
    const message = connectionError || realtimeError?.message;
    if (!message) return null;

    return (
        <div
            role="status"
            aria-live="polite"
            className="absolute top-2 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3
                       max-w-[90%] px-4 py-2 rounded-md shadow-lg
                       bg-amber-500/95 text-amber-950 text-sm"
        >
            <span className="truncate">{message}</span>
            {!connectionError && (
                <button
                    onClick={dismissRealtimeError}
                    aria-label="Dismiss"
                    className="font-bold leading-none hover:text-amber-700 focus:outline-none"
                >
                    &times;
                </button>
            )}
        </div>
    );
}

export default RealtimeNotice;
