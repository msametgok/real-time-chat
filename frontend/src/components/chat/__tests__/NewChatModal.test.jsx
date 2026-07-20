import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The modal reads everything it needs from the chat context.
const chat = {
    searchUsers: vi.fn(),
    createOneOnOneChatAPI: vi.fn(),
    createGroupChatAPI: vi.fn(),
};
vi.mock('../../../hooks/useChat', () => ({ useChat: () => chat }));

import NewChatModal from '../NewChatModal';

const BOB = { _id: 'user-2', username: 'bob' };
const CAROL = { _id: 'user-3', username: 'carol' };

let user;
let onClose;

beforeEach(() => {
    vi.clearAllMocks();
    // The search is debounced 250ms. Without shouldAdvanceTime every
    // `await user.type(...)` deadlocks on a microtask the frozen clock never
    // flushes - see the frontend timer-test note in CLAUDE.md.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    onClose = vi.fn();
    chat.searchUsers.mockResolvedValue([BOB, CAROL]);
    chat.createOneOnOneChatAPI.mockResolvedValue({ _id: 'chat-new' });
    chat.createGroupChatAPI.mockResolvedValue({ _id: 'chat-group' });
});

afterEach(() => vi.useRealTimers());

const open = async () => {
    render(<NewChatModal isOpen onClose={onClose} />);
    // Flush the initial debounced search.
    await act(async () => { vi.advanceTimersByTime(300); });
    await screen.findByText('bob');
};

describe('NewChatModal', () => {
    it('renders nothing when closed', () => {
        const { container } = render(<NewChatModal isOpen={false} onClose={onClose} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('lists users on open without typing anything', async () => {
        await open();

        // An empty keyword means "list everyone" - the modal must not sit blank
        // waiting for input.
        expect(chat.searchUsers).toHaveBeenCalledWith('', { limit: 20 });
        expect(screen.getByText('carol')).toBeInTheDocument();
    });

    it('starts a direct chat with one selected user', async () => {
        await open();

        await user.click(screen.getByText('bob'));
        await user.click(screen.getByRole('button', { name: /start chat/i }));

        await waitFor(() => expect(chat.createOneOnOneChatAPI).toHaveBeenCalledWith('user-2'));
        expect(chat.createGroupChatAPI).not.toHaveBeenCalled();
        await waitFor(() => expect(onClose).toHaveBeenCalled());
    });

    // Two or more selections switch the modal to group mode, which needs a name.
    it('requires a group name once a second user is picked', async () => {
        await open();

        await user.click(screen.getByText('bob'));
        await user.click(screen.getByText('carol'));

        const create = screen.getByRole('button', { name: /create group/i });
        expect(create).toBeDisabled();

        await user.type(screen.getByLabelText(/group name/i), 'Team');
        expect(create).toBeEnabled();

        await user.click(create);
        await waitFor(() =>
            expect(chat.createGroupChatAPI).toHaveBeenCalledWith('Team', ['user-2', 'user-3'])
        );
    });

    it('deselects a user when their chip is clicked', async () => {
        await open();

        await user.click(screen.getByText('bob'));
        await user.click(screen.getByRole('button', { name: /remove bob/i }));

        expect(screen.getByRole('button', { name: /start chat/i })).toBeDisabled();
    });

    // A failed create must keep the modal open with the picks intact, and must
    // not reach ChatList's chatError - that renders instead of the sidebar.
    it('shows a failure in the modal and stays open', async () => {
        await open();
        chat.createOneOnOneChatAPI.mockRejectedValue(new Error('The other user not found'));

        await user.click(screen.getByText('bob'));
        await user.click(screen.getByRole('button', { name: /start chat/i }));

        expect(await screen.findByText(/the other user not found/i)).toBeInTheDocument();
        expect(onClose).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: /remove bob/i })).toBeInTheDocument();
    });

    it('surfaces a search failure without crashing', async () => {
        chat.searchUsers.mockRejectedValue(new Error('Server error while searching users'));
        render(<NewChatModal isOpen onClose={onClose} />);

        await act(async () => { vi.advanceTimersByTime(300); });

        expect(await screen.findByText(/server error while searching users/i)).toBeInTheDocument();
    });

    it('closes on Escape', async () => {
        await open();

        await user.keyboard('{Escape}');

        expect(onClose).toHaveBeenCalled();
    });

    // Typing fast leaves several searches in flight; only the newest may write.
    it('ignores a slow search that was superseded', async () => {
        let releaseSlow;
        chat.searchUsers
            .mockImplementationOnce(() => new Promise(r => { releaseSlow = () => r([BOB]); }))
            .mockResolvedValue([CAROL]);

        render(<NewChatModal isOpen onClose={onClose} />);
        await act(async () => { vi.advanceTimersByTime(300); });

        await user.type(screen.getByLabelText(/search users/i), 'car');
        await act(async () => { vi.advanceTimersByTime(300); });
        await screen.findByText('carol');

        // The first search resolves last and must not overwrite the newer list.
        await act(async () => { releaseSlow(); });

        expect(screen.getByText('carol')).toBeInTheDocument();
        expect(screen.queryByText('bob')).not.toBeInTheDocument();
    });
});
