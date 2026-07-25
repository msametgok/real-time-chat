import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import GroupInfoModal from '../GroupInfoModal';

const ADMIN = { _id: 'user-1', username: 'alice' };
const MEMBER = { _id: 'user-2', username: 'bob' };
const THIRD = { _id: 'user-3', username: 'carol' };
const OUTSIDER = { _id: 'user-9', username: 'dave' };

const groupChat = (overrides = {}) => ({
    _id: 'chat-1',
    isGroupChat: true,
    chatName: 'The gang',
    groupAvatarUrl: null,
    participants: [ADMIN, MEMBER, THIRD],
    groupAdmin: ADMIN,
    ...overrides
});

let mockChat = {};
vi.mock('../../../hooks/useChat', () => ({
    useChat: () => mockChat
}));

let mockAuthUser = ADMIN;
vi.mock('../../../hooks/useAuth', () => ({
    useAuth: () => ({ user: mockAuthUser, isAuthenticated: true })
}));

const renderModal = () =>
    render(<GroupInfoModal isOpen onClose={vi.fn()} />);

beforeEach(() => {
    mockAuthUser = ADMIN;
    mockChat = {
        activeChat: groupChat(),
        updateGroupChatAPI: vi.fn().mockResolvedValue({}),
        addGroupParticipantsAPI: vi.fn().mockResolvedValue({}),
        removeGroupParticipantAPI: vi.fn().mockResolvedValue({}),
        searchUsers: vi.fn().mockResolvedValue([])
    };
});

describe('GroupInfoModal', () => {
    it('lists every member and badges the admin', () => {
        renderModal();

        expect(screen.getByText(/alice/)).toBeInTheDocument();
        expect(screen.getByText('bob')).toBeInTheDocument();
        expect(screen.getByText('carol')).toBeInTheDocument();
        expect(screen.getByText('admin')).toBeInTheDocument();
        expect(screen.getByText('3 members')).toBeInTheDocument();
    });

    it('saves only the fields that actually changed', async () => {
        const user = userEvent.setup();
        renderModal();

        const nameInput = screen.getByLabelText('Group name');
        await user.clear(nameInput);
        await user.type(nameInput, 'New gang');
        await user.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() =>
            expect(mockChat.updateGroupChatAPI).toHaveBeenCalledWith('chat-1', { chatName: 'New gang' })
        );
    });

    it('does not call the API when nothing changed', async () => {
        const user = userEvent.setup();
        renderModal();

        await user.click(screen.getByRole('button', { name: 'Save' }));

        expect(mockChat.updateGroupChatAPI).not.toHaveBeenCalled();
    });

    it('removes a member on request, never offering Remove for yourself', async () => {
        const user = userEvent.setup();
        renderModal();

        const removeButtons = screen.getAllByRole('button', { name: 'Remove' });
        // Three members, one of them is you.
        expect(removeButtons).toHaveLength(2);

        await user.click(removeButtons[0]);

        await waitFor(() =>
            expect(mockChat.removeGroupParticipantAPI).toHaveBeenCalledWith('chat-1', MEMBER._id)
        );
    });

    it('searches and adds a non-member', async () => {
        // The member search must not offer people who are already in.
        mockChat.searchUsers.mockResolvedValue([MEMBER, OUTSIDER]);
        const user = userEvent.setup();
        renderModal();

        await waitFor(() => expect(screen.getByText('dave')).toBeInTheDocument());
        expect(screen.queryByRole('button', { name: 'Add' })).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Add' }));

        await waitFor(() =>
            expect(mockChat.addGroupParticipantsAPI).toHaveBeenCalledWith('chat-1', [OUTSIDER._id])
        );
    });

    it('shows an API failure inline instead of blanking anything', async () => {
        mockChat.removeGroupParticipantAPI.mockRejectedValue(new Error('Only the group admin can do this.'));
        const user = userEvent.setup();
        renderModal();

        await user.click(screen.getAllByRole('button', { name: 'Remove' })[0]);

        await waitFor(() =>
            expect(screen.getByRole('alert')).toHaveTextContent('Only the group admin can do this.')
        );
    });

    describe('as a regular member', () => {
        beforeEach(() => { mockAuthUser = MEMBER; });

        it('is read-only: no rename, no removals, no member search', () => {
            renderModal();

            expect(screen.getByText('The gang')).toBeInTheDocument();
            expect(screen.getByText('3 members')).toBeInTheDocument();
            expect(screen.queryByLabelText('Group name')).not.toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
            expect(screen.queryByLabelText('Search users to add')).not.toBeInTheDocument();
            expect(mockChat.searchUsers).not.toHaveBeenCalled();
        });
    });

    it('renders nothing for a 1-on-1 chat', () => {
        mockChat.activeChat = { _id: 'chat-2', isGroupChat: false, participants: [ADMIN, MEMBER] };
        renderModal();

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
});
