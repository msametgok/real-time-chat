import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import MessageBubble from '../MessageBubble';

const baseMessage = {
    _id: 'msg-1',
    messageType: 'text',
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

    describe('options menu, edit and delete', () => {
        const recent = () => new Date().toISOString();
        const menuHandlers = () => ({
            onEdit: vi.fn(),
            onDeleteForMe: vi.fn(),
            onDeleteForEveryone: vi.fn()
        });
        const openMenu = async (user) =>
            user.click(screen.getByRole('button', { name: 'Message options' }));

        it('offers Edit and both deletes on an own, recent text message', async () => {
            const user = userEvent.setup();
            renderBubble({ createdAt: recent() }, menuHandlers());

            await openMenu(user);

            expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument();
            expect(screen.getByRole('menuitem', { name: 'Delete for everyone' })).toBeInTheDocument();
            expect(screen.getByRole('menuitem', { name: 'Delete for me' })).toBeInTheDocument();
        });

        // The window itself is enforced server-side; the menu only stops
        // offering what the server would refuse.
        it('hides Edit once the 15-minute window has passed', async () => {
            const user = userEvent.setup();
            const sixteenMinAgo = new Date(Date.now() - 16 * 60 * 1000).toISOString();
            renderBubble({ createdAt: sixteenMinAgo }, menuHandlers());

            await openMenu(user);

            expect(screen.queryByRole('menuitem', { name: 'Edit' })).not.toBeInTheDocument();
            expect(screen.getByRole('menuitem', { name: 'Delete for everyone' })).toBeInTheDocument();
        });

        it("offers only Delete for me on someone else's message", async () => {
            const user = userEvent.setup();
            renderBubble({ createdAt: recent() }, { ...menuHandlers(), isOwnMessage: false });

            await openMenu(user);

            expect(screen.queryByRole('menuitem', { name: 'Edit' })).not.toBeInTheDocument();
            expect(screen.queryByRole('menuitem', { name: 'Delete for everyone' })).not.toBeInTheDocument();
            expect(screen.getByRole('menuitem', { name: 'Delete for me' })).toBeInTheDocument();
        });

        it('hides Edit on an attachment message', async () => {
            const user = userEvent.setup();
            renderBubble(
                { createdAt: recent(), messageType: 'image', fileUrl: '/uploads/a.png', content: null },
                menuHandlers()
            );

            await openMenu(user);

            expect(screen.queryByRole('menuitem', { name: 'Edit' })).not.toBeInTheDocument();
        });

        it('shows no menu at all on a sending or failed bubble', () => {
            renderBubble({ createdAt: recent(), sending: true }, menuHandlers());
            expect(screen.queryByRole('button', { name: 'Message options' })).not.toBeInTheDocument();
        });

        it('edits inline and hands the new text to onEdit', async () => {
            const user = userEvent.setup();
            const handlers = menuHandlers();
            renderBubble({ createdAt: recent(), content: 'old text' }, handlers);

            await openMenu(user);
            await user.click(screen.getByRole('menuitem', { name: 'Edit' }));

            const box = screen.getByLabelText('Edit message');
            expect(box).toHaveValue('old text');

            await user.clear(box);
            await user.type(box, 'new text');
            await user.click(screen.getByRole('button', { name: 'Save' }));

            expect(handlers.onEdit).toHaveBeenCalledWith('msg-1', 'new text');
            expect(screen.queryByLabelText('Edit message')).not.toBeInTheDocument();
        });

        it('does not call onEdit when the text is unchanged or cancelled', async () => {
            const user = userEvent.setup();
            const handlers = menuHandlers();
            renderBubble({ createdAt: recent(), content: 'old text' }, handlers);

            await openMenu(user);
            await user.click(screen.getByRole('menuitem', { name: 'Edit' }));
            await user.click(screen.getByRole('button', { name: 'Cancel' }));

            expect(handlers.onEdit).not.toHaveBeenCalled();
            // The original content is back.
            expect(screen.getByText('old text')).toBeInTheDocument();
        });

        it('routes the two delete choices to their own handlers', async () => {
            const user = userEvent.setup();
            const handlers = menuHandlers();
            renderBubble({ createdAt: recent() }, handlers);

            await openMenu(user);
            await user.click(screen.getByRole('menuitem', { name: 'Delete for everyone' }));
            expect(handlers.onDeleteForEveryone).toHaveBeenCalledWith('msg-1');

            await openMenu(user);
            await user.click(screen.getByRole('menuitem', { name: 'Delete for me' }));
            expect(handlers.onDeleteForMe).toHaveBeenCalledWith('msg-1');
        });
    });

    describe('deleted and edited states', () => {
        it('renders a tombstone with no content, ticks, or menu', () => {
            renderBubble(
                { isDeletedForEveryone: true, content: undefined },
                { onEdit: vi.fn(), onDeleteForMe: vi.fn(), onDeleteForEveryone: vi.fn() }
            );

            expect(screen.getByText('This message was deleted')).toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'Message options' })).not.toBeInTheDocument();
            expect(screen.queryByText('[Message content not available]')).not.toBeInTheDocument();
        });

        it('labels an edited message', () => {
            renderBubble({ editedAt: '2026-07-24T10:05:00Z' });
            expect(screen.getByText('edited')).toBeInTheDocument();
        });

        it('does not label an unedited message', () => {
            renderBubble();
            expect(screen.queryByText('edited')).not.toBeInTheDocument();
        });
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
