import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const chat = {
    activeChat: null,
    selectChat: vi.fn(),
    presence: {},
    deleteChat: vi.fn(),
};
vi.mock('../../../hooks/useChat', () => ({ useChat: () => chat }));
vi.mock('../../../hooks/useAuth', () => ({
    useAuth: () => ({ user: { _id: 'user-1', username: 'alice' } })
}));

import ChatWindowHeader from '../ChatWindowHeader';

const DIRECT = {
    _id: 'chat-1',
    isGroupChat: false,
    displayChatName: 'bob',
    participants: [{ _id: 'user-1' }, { _id: 'user-2' }]
};

const GROUP = {
    _id: 'chat-2',
    isGroupChat: true,
    displayChatName: 'Team',
    participants: [{ _id: 'user-1' }, { _id: 'user-2' }, { _id: 'user-3' }]
};

let user;

beforeEach(() => {
    vi.clearAllMocks();
    user = userEvent.setup();
    chat.activeChat = DIRECT;
    chat.deleteChat = vi.fn().mockResolvedValue(undefined);
});

const openMenu = async () => {
    render(<ChatWindowHeader />);
    await user.click(screen.getByRole('button', { name: /chat options/i }));
};

describe('ChatWindowHeader actions', () => {
    it('renders nothing without an active chat', () => {
        chat.activeChat = null;
        const { container } = render(<ChatWindowHeader />);
        expect(container).toBeEmptyDOMElement();
    });

    it('offers Delete chat for a direct conversation', async () => {
        await openMenu();
        expect(screen.getByRole('menuitem', { name: /delete chat/i })).toBeInTheDocument();
    });

    it('offers Leave group for a group conversation', async () => {
        chat.activeChat = GROUP;
        await openMenu();
        expect(screen.getByRole('menuitem', { name: /leave group/i })).toBeInTheDocument();
    });

    // A soft delete does not touch the other person's copy, and the wording
    // needs to say so - the old backend behaviour destroyed both sides.
    it('says the other person keeps their copy', async () => {
        await openMenu();

        await user.click(screen.getByRole('menuitem', { name: /delete chat/i }));

        expect(screen.getByText(/bob will still have it/i)).toBeInTheDocument();
    });

    it('requires confirmation before removing', async () => {
        await openMenu();

        await user.click(screen.getByRole('menuitem', { name: /delete chat/i }));
        expect(chat.deleteChat).not.toHaveBeenCalled();

        await user.click(screen.getByRole('button', { name: /^remove$/i }));
        await waitFor(() => expect(chat.deleteChat).toHaveBeenCalledWith('chat-1'));
    });

    it('cancels without removing', async () => {
        await openMenu();

        await user.click(screen.getByRole('menuitem', { name: /delete chat/i }));
        await user.click(screen.getByRole('button', { name: /cancel/i }));

        expect(chat.deleteChat).not.toHaveBeenCalled();
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('reports a failure in place instead of closing silently', async () => {
        chat.deleteChat = vi.fn().mockRejectedValue(new Error('Access Denied'));
        await openMenu();

        await user.click(screen.getByRole('menuitem', { name: /delete chat/i }));
        await user.click(screen.getByRole('button', { name: /^remove$/i }));

        expect(await screen.findByRole('alert')).toHaveTextContent(/access denied/i);
    });

    it('closes the menu on Escape', async () => {
        await openMenu();
        expect(screen.getByRole('menu')).toBeInTheDocument();

        await user.keyboard('{Escape}');

        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
});
