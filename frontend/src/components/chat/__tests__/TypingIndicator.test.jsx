import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// The whole point of Phase 3's typing fix is that the indicator is filtered
// HERE, by the chat being rendered - the socket handler records every chat.
let chatValue = {};
vi.mock('../../../hooks/useChat', () => ({ useChat: () => chatValue }));
vi.mock('../../../hooks/useAuth', () => ({
    useAuth: () => ({ user: { _id: 'user-1', username: 'alice' } })
}));

import { TypingIndicator } from '../ChatWindow';

const renderIndicator = (typingUsers, activeChatId = 'chat-1') => {
    chatValue = { typingUsers, activeChat: { _id: activeChatId } };
    return render(<TypingIndicator />);
};

describe('TypingIndicator', () => {
    it('shows a typist in the chat being viewed', () => {
        renderIndicator({ 'chat-1': { 'user-2': { username: 'bob' } } });
        expect(screen.getByText('bob is typing...')).toBeInTheDocument();
    });

    // The bug this replaces: state keyed by userId alone meant an indicator
    // raised in chat-1 rendered while you were looking at chat-2.
    it('does not show a typist from a different chat', () => {
        renderIndicator({ 'chat-2': { 'user-2': { username: 'bob' } } }, 'chat-1');
        expect(screen.queryByText(/typing/)).not.toBeInTheDocument();
    });

    it('names both typists when two people are typing here', () => {
        renderIndicator({
            'chat-1': { 'user-2': { username: 'bob' }, 'user-3': { username: 'carol' } }
        });
        expect(screen.getByText('bob and carol are typing...')).toBeInTheDocument();
    });

    it('collapses to a generic message beyond two typists', () => {
        renderIndicator({
            'chat-1': {
                'user-2': { username: 'bob' },
                'user-3': { username: 'carol' },
                'user-4': { username: 'dave' }
            }
        });
        expect(screen.getByText('Several people are typing...')).toBeInTheDocument();
    });

    it('never shows yourself', () => {
        renderIndicator({ 'chat-1': { 'user-1': { username: 'alice' } } });
        expect(screen.queryByText(/typing/)).not.toBeInTheDocument();
    });

    it('renders nothing when no chat is open', () => {
        chatValue = { typingUsers: { 'chat-1': { 'user-2': { username: 'bob' } } }, activeChat: null };
        render(<TypingIndicator />);
        expect(screen.queryByText(/typing/)).not.toBeInTheDocument();
    });
});
