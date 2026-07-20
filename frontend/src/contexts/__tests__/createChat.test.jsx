import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

let chatRestoredHandler = null;

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
        onChatRestored: vi.fn(cb => { chatRestoredHandler = cb; }), offChatRestored: vi.fn(),
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
        deleteChat: vi.fn(),
    }
}));

const mockUser = { _id: 'user-1', username: 'alice', token: 'tok' };
vi.mock('../../hooks/useAuth', () => ({
    useAuth: () => ({ user: mockUser, isAuthenticated: true })
}));

import api from '../../services/api';
import socketService from '../../services/socket';
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
    chatRestoredHandler = null;
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

describe('removing a chat', () => {
    const EXISTING = {
        _id: 'chat-1',
        isGroupChat: false,
        displayChatName: 'bob',
        participants: [{ _id: 'user-1' }, { _id: 'user-2' }],
        updatedAt: '2026-07-20T10:00:00Z'
    };

    const withChat = async () => {
        api.getUserChats.mockResolvedValue([EXISTING]);
        const rendered = renderHook(() => useChat(), { wrapper });
        await waitFor(() => expect(rendered.result.current.chats).toHaveLength(1));
        return rendered;
    };

    it('drops the chat from the sidebar once the server confirms', async () => {
        const { result } = await withChat();
        api.deleteChat.mockResolvedValue({ message: 'Chat removed from your list.' });

        await act(async () => { await result.current.deleteChat('chat-1'); });

        expect(api.deleteChat).toHaveBeenCalledWith('chat-1', 'tok');
        expect(result.current.chats).toHaveLength(0);
    });

    it('leaves the room and forgets the join bookkeeping', async () => {
        const { result } = await withChat();
        api.deleteChat.mockResolvedValue({});

        await act(async () => { await result.current.deleteChat('chat-1'); });

        expect(socketService.leaveChat).toHaveBeenCalledWith('chat-1');
    });

    it('closes the conversation when the open chat is the one removed', async () => {
        const { result } = await withChat();
        api.deleteChat.mockResolvedValue({});
        await act(async () => { await result.current.selectChat('chat-1'); });
        expect(result.current.activeChat?._id).toBe('chat-1');

        await act(async () => { await result.current.deleteChat('chat-1'); });

        expect(result.current.activeChat).toBeNull();
        expect(result.current.messages).toEqual([]);
    });

    // Removing a chat you are not looking at must not close the one you are.
    it('leaves the open conversation alone when a different chat is removed', async () => {
        api.getUserChats.mockResolvedValue([
            EXISTING,
            { ...EXISTING, _id: 'chat-2', displayChatName: 'carol' }
        ]);
        const { result } = renderHook(() => useChat(), { wrapper });
        await waitFor(() => expect(result.current.chats).toHaveLength(2));
        api.deleteChat.mockResolvedValue({});

        await act(async () => { await result.current.selectChat('chat-2'); });
        await act(async () => { await result.current.deleteChat('chat-1'); });

        expect(result.current.activeChat?._id).toBe('chat-2');
        expect(result.current.chats.map(c => c._id)).toEqual(['chat-2']);
    });

    // No optimistic removal: hiding a chat the server refused to remove would
    // conceal a live conversation until the next refetch.
    it('keeps the chat when the server refuses', async () => {
        const { result } = await withChat();
        api.deleteChat.mockRejectedValue(new Error('Access Denied'));

        await expect(
            act(async () => { await result.current.deleteChat('chat-1'); })
        ).rejects.toThrow('Access Denied');

        expect(result.current.chats).toHaveLength(1);
        expect(result.current.chatError).toBeNull();
    });
});

describe('a soft-deleted chat coming back', () => {
    const RESTORED = {
        _id: 'chat-1',
        isGroupChat: false,
        displayChatName: 'bob',
        participants: [{ _id: 'user-1' }, { _id: 'user-2' }],
        unreadCount: 3,
        updatedAt: '2026-07-20T10:00:00Z'
    };

    // We left the chat's room when we deleted it, so the newMessage broadcast
    // cannot reach us. Without refetching, the chat stays missing from the
    // sidebar until a manual page reload - which is what the user hit.
    it('refetches so the chat reappears with its unread badge', async () => {
        const { result } = await render();
        expect(result.current.chats).toHaveLength(0);

        api.getUserChats.mockResolvedValue([RESTORED]);
        await act(async () => { chatRestoredHandler({ chatId: 'chat-1' }); });

        await waitFor(() => expect(result.current.chats).toHaveLength(1));
        // The badge comes from the server, so it is right immediately.
        expect(result.current.chats[0].unreadCount).toBe(3);
    });

    it('does not refetch for a chat already in the sidebar', async () => {
        api.getUserChats.mockResolvedValue([RESTORED]);
        const { result } = renderHook(() => useChat(), { wrapper });
        await waitFor(() => expect(result.current.chats).toHaveLength(1));
        api.getUserChats.mockClear();

        await act(async () => { chatRestoredHandler({ chatId: 'chat-1' }); });

        expect(api.getUserChats).not.toHaveBeenCalled();
    });

    it('ignores a payload with no chatId', async () => {
        await render();
        api.getUserChats.mockClear();

        await act(async () => { chatRestoredHandler({}); });

        expect(api.getUserChats).not.toHaveBeenCalled();
    });
});
