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

    describe('attachments', () => {
        it('renders an image message as an image resolved against the API base', () => {
            renderBubble({ messageType: 'image', content: null, fileUrl: '/uploads/abc.png', fileName: 'cat.png' });

            const img = screen.getByRole('img', { name: 'cat.png' });
            expect(img).toHaveAttribute('src', 'http://localhost:5000/uploads/abc.png');
        });

        // While the upload is in flight there is no server URL yet - the local
        // blob preview must be used so the bubble is never an empty box.
        it('prefers the local preview while the upload is in flight', () => {
            renderBubble({
                messageType: 'image', content: null, fileUrl: null,
                localPreviewUrl: 'blob:preview', fileName: 'cat.png', sending: true
            });

            expect(screen.getByRole('img', { name: 'cat.png' })).toHaveAttribute('src', 'blob:preview');
        });

        it('renders a generic file as a download card with name and size', () => {
            renderBubble({
                messageType: 'file', content: null,
                fileUrl: '/uploads/abc.pdf', fileName: 'notes.pdf', fileSize: 2048
            });

            expect(screen.getByText('notes.pdf')).toBeInTheDocument();
            expect(screen.getByText('2.0 KB')).toBeInTheDocument();
            const link = screen.getByRole('link');
            expect(link).toHaveAttribute('href', 'http://localhost:5000/uploads/abc.pdf');
        });

        it('renders a file card without a link while still uploading', () => {
            renderBubble({
                messageType: 'file', content: null,
                fileUrl: null, file: {}, fileName: 'notes.pdf', fileSize: 10, sending: true
            });

            expect(screen.getByText('notes.pdf')).toBeInTheDocument();
            expect(screen.queryByRole('link')).not.toBeInTheDocument();
        });

        it('shows a caption instead of the missing-content placeholder', () => {
            renderBubble({
                messageType: 'image', fileUrl: '/uploads/abc.png',
                fileName: 'cat.png', content: 'look at this'
            });

            expect(screen.getByText('look at this')).toBeInTheDocument();
            expect(screen.queryByText('[Message content not available]')).not.toBeInTheDocument();
        });
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
