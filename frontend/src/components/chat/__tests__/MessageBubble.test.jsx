import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import MessageBubble from '../MessageBubble';

const baseMessage = {
    _id: 'msg-1',
    content: 'hello there',
    createdAt: '2026-07-18T12:00:00.000Z',
    sender: { _id: 'user-1', username: 'alice' },
    deliveredTo: [],
    readBy: []
};

const renderBubble = (overrides = {}, props = {}) =>
    render(
        <MessageBubble
            message={{ ...baseMessage, ...overrides }}
            isOwnMessage
            showSenderInfo={false}
            {...props}
        />
    );

describe('MessageBubble', () => {
    it('renders message content', () => {
        renderBubble();
        expect(screen.getByText('hello there')).toBeInTheDocument();
    });

    it('shows a timestamp for a normal message', () => {
        renderBubble();
        expect(screen.queryByText('Not delivered')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
    });

    describe('failed message', () => {
        // The `failed` flag was set in ChatContext long before anything rendered
        // it - a failed send was visually identical to a successful one.
        it('shows "Not delivered" instead of the timestamp', () => {
            renderBubble({ failed: true, sending: false });
            expect(screen.getByText('Not delivered')).toBeInTheDocument();
        });

        it('offers a Retry button when a handler is provided', () => {
            renderBubble({ failed: true }, { onRetry: vi.fn() });
            expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
        });

        it('calls onRetry with the message id', async () => {
            const onRetry = vi.fn();
            const user = userEvent.setup();

            renderBubble({ _id: 'temp-abc', failed: true }, { onRetry });
            await user.click(screen.getByRole('button', { name: /retry/i }));

            expect(onRetry).toHaveBeenCalledWith('temp-abc');
        });

        it('omits Retry when no handler is passed', () => {
            renderBubble({ failed: true });
            expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
        });

        it('still renders the original content so text is never lost', () => {
            renderBubble({ failed: true, content: 'important message' });
            expect(screen.getByText('important message')).toBeInTheDocument();
        });
    });

    it('falls back gracefully when content is missing', () => {
        renderBubble({ content: null });
        expect(screen.getByText('[Message content not available]')).toBeInTheDocument();
    });

    // jsdom does no layout, so overflow itself is not observable here - assert
    // the classes that fix it instead. An unbroken string used to push past the
    // bubble's max-width and give the whole message list a horizontal scrollbar,
    // and Shift+Enter newlines were collapsed to spaces.
    it('wraps long content and preserves newlines', () => {
        renderBubble({ content: 'aaaa\nbbbb' });
        const content = screen.getByText((_, el) => el.textContent === 'aaaa\nbbbb'
            && el.className.includes('break-words'));
        expect(content.className).toContain('whitespace-pre-wrap');
    });
});
