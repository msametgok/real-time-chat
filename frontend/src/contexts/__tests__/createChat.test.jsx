import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/socket', () => ({
    default: {
        sendMessage: vi.fn(() => true),
        connect: vi.fn(() => Promise.resolve()),
        disconnect: vi.fn(),
        getSocket: vi.fn(() => null),
        joinChat: vi.fn(),
        leaveChat: vi.fn(),
        typingStart: vi.fn(),
        typingStop: vi.fn(),
        markMessagesAsRead: vi.fn(),
        markChatAsRead: vi.fn(() => true),
        messageDeliveredToClient: vi.fn(),
        onNewMessage: vi.fn(), offNewMessage: vi.fn(),
        onNewChat: vi.fn(), offNewChat: vi.fn(),
        onTyping: vi.fn(), offTyping: vi.fn(),
        onMessagesReadUpdate: vi.fn(), offMessagesReadUpdate: vi.fn(),
        onMessageDeliveryUpdate: vi.fn(), offMessageDeliveryUpdate: vi.fn(),
        onUserConnectedToChat: vi.fn(), offUserConnectedToChat: vi.fn(),
        onUserStatusUpdate: vi.fn(), offUserStatusUpdate: vi.fn(),
        onMessageSentAck: vi.fn(), offMessageSentAck: vi.fn(),
        onMessageError: vi.fn(), offMessageError: vi.fn(),
        onChatError: vi.fn(), offChatError: vi.fn(),
        onStatusError: vi.fn(), offStatusError: vi.fn(),
    }
}));

vi.mock('../../services/api', () => ({
    default: {
        getUserChats: vi.fn(() => Promise.resolve([])),
        getChatMessages: vi.fn(() => Promise.resolve({ messages: [] })),
        createOneOnOneChat: vi.fn(),
        createGroupChat: vi.fn(),
        searchUsers: vi.fn(),
    }
}));

const mockUser = { _id: 'user-1', username: 'alice', token: 'tok' };
vi.mock('../../hooks/useAuth', () => ({
    useAuth: () => ({ user: mockUser, isAuthenticated: true })
}));

import api from '../../services/api';
import { ChatProvider } from '../ChatContext';
import { useChat } from '../../hooks/useChat';

const wrapper = ({ children }) => <ChatProvider>{children}</ChatProvider>;

const NEW_CHAT = {
    _id: 'chat-new',
    isGroupChat: false,
    displayChatName: 'bob',
    participants: [{ _id: 'user-1' }, { _id: 'user-2' }],
    updatedAt: '2026-07-20T12:00:00Z'
};

const render = async () => {
    const rendered = renderHook(() => useChat(), { wrapper });
    await waitFor(() => expect(api.getUserChats).toHaveBeenCalled());
    return rendered;
};

beforeEach(() => {
    vi.clearAllMocks();
    api.getUserChats.mockResolvedValue([]);
    api.getChatMessages.mockResolvedValue({ messages: [] });
});

describe('creating a chat', () => {
    // The bug that kept this feature unwired: selectChat looked the chat up in
    // the `chats` closure, but createOneOnOneChatAPI calls it immediately after
    // fetchChats(), whose setChats has not reached that closure yet (gotcha 5).
    // The brand-new chat was never found, so activeChat was set to null and
    // clicking "Start chat" appeared to do nothing.
    it('opens the chat it just created', async () => {
        const { result } = await render();
        api.createOneOnOneChat.mockResolvedValue({ chat: NEW_CHAT });
        // The refetch still does not include it - that is the whole point.
        api.getUserChats.mockResolvedValue([]);

        await act(async () => { await result.current.createOneOnOneChatAPI('user-2'); });

        expect(result.current.activeChat?._id).toBe('chat-new');
    });

    it('opens a group chat it just created', async () => {
        const { result } = await render();
        const group = { ...NEW_CHAT, _id: 'chat-group', isGroupChat: true };
        api.createGroupChat.mockResolvedValue({ chat: group });

        await act(async () => {
            await result.current.createGroupChatAPI('Team', ['user-2', 'user-3']);
        });

        expect(result.current.activeChat?._id).toBe('chat-group');
        expect(api.createGroupChat).toHaveBeenCalledWith('Team', ['user-2', 'user-3'], 'tok');
    });

    // The server answers 200 with the existing chat rather than an error.
    it('opens an existing chat instead of treating it as a failure', async () => {
        const { result } = await render();
        api.createOneOnOneChat.mockResolvedValue({
            message: 'Chat already exists',
            chat: NEW_CHAT
        });

        await act(async () => { await result.current.createOneOnOneChatAPI('user-2'); });

        expect(result.current.activeChat?._id).toBe('chat-new');
        expect(result.current.chatError).toBeNull();
    });

    // chatError is what ChatList renders INSTEAD of the sidebar, so writing a
    // creation failure there would blank the chat list behind the modal.
    it('throws on failure without blanking the sidebar', async () => {
        const { result } = await render();
        api.createOneOnOneChat.mockRejectedValue(new Error('The other user not found'));

        await expect(
            act(async () => { await result.current.createOneOnOneChatAPI('nope'); })
        ).rejects.toThrow('The other user not found');

        expect(result.current.chatError).toBeNull();
    });

    it('passes the search keyword through and returns the user list', async () => {
        const { result } = await render();
        api.searchUsers.mockResolvedValue({ users: [{ _id: 'user-2', username: 'bob' }] });

        let users;
        await act(async () => { users = await result.current.searchUsers('bo', { limit: 20 }); });

        expect(api.searchUsers).toHaveBeenCalledWith('bo', 'tok', { limit: 20 });
        expect(users).toEqual([{ _id: 'user-2', username: 'bob' }]);
    });

    it('returns an empty list when the server sends no users field', async () => {
        const { result } = await render();
        api.searchUsers.mockResolvedValue({});

        let users;
        await act(async () => { users = await result.current.searchUsers(''); });

        expect(users).toEqual([]);
    });
});
