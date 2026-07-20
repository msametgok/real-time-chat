import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Captured handlers, so tests drive ChatContext directly instead of standing
// up a real socket.
let typingHandler = null;

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
        messageDeliveredToClient: vi.fn(),
        onNewMessage: vi.fn(), offNewMessage: vi.fn(),
        onTyping: vi.fn(cb => { typingHandler = cb; }), offTyping: vi.fn(),
        onMessagesReadUpdate: vi.fn(), offMessagesReadUpdate: vi.fn(),
        onMessageDeliveryUpdate: vi.fn(), offMessageDeliveryUpdate: vi.fn(),
        onUserConnectedToChat: vi.fn(), offUserConnectedToChat: vi.fn(),
        onUserStatusUpdate: vi.fn(), offUserStatusUpdate: vi.fn(),
        onMessageSentAck: vi.fn(), offMessageSentAck: vi.fn(),
        onMessageError: vi.fn(), offMessageError: vi.fn(),
    }
}));

vi.mock('../../services/api', () => ({
    default: {
        getUserChats: vi.fn(() => Promise.resolve([])),
        getChatMessages: vi.fn(() => Promise.resolve({ messages: [] })),
        createOneOnOneChat: vi.fn(),
        createGroupChat: vi.fn(),
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

const CHAT_1 = 'chat-1';
const CHAT_2 = 'chat-2';

const chatFixture = (id, updatedAt) => ({
    _id: id,
    isGroupChat: false,
    participants: [{ _id: 'user-1' }, { _id: 'user-2' }],
    unreadCount: 0,
    updatedAt
});

const renderChats = async () => {
    api.getUserChats.mockResolvedValue([
        chatFixture(CHAT_1, '2026-07-19T09:00:00Z'),
        chatFixture(CHAT_2, '2026-07-19T08:00:00Z')
    ]);

    const rendered = renderHook(() => useChat(), { wrapper });
    await waitFor(() => expect(rendered.result.current.chats).toHaveLength(2));
    return rendered;
};

const typing = (chatId, userId, isTyping) => ({
    chatId, userId, username: userId === 'user-2' ? 'bob' : 'carol', isTyping
});

beforeEach(() => {
    vi.clearAllMocks();
    typingHandler = null;
    api.getChatMessages.mockResolvedValue({ messages: [] });
});

describe('typing state is scoped per chat', () => {
    // The old state was keyed by userId alone, so an indicator raised in chat-1
    // rendered in chat-2 as well.
    it('records the indicator under the chat it came from', async () => {
        const { result } = await renderChats();
        await act(async () => { await result.current.selectChat(CHAT_1); });

        await act(async () => { typingHandler(typing(CHAT_1, 'user-2', true)); });

        expect(result.current.typingUsers[CHAT_1]).toEqual({ 'user-2': { username: 'bob' } });
        expect(result.current.typingUsers[CHAT_2]).toBeUndefined();
    });

    // The old handler gated on `chatId === activeChat._id`, which ALSO blocked
    // the isTyping:false cleanup - so once you switched chats, the indicator
    // could never be cleared.
    it('applies isTyping:false for a chat that is not currently open', async () => {
        const { result } = await renderChats();
        await act(async () => { await result.current.selectChat(CHAT_1); });

        // Switch away, then bob types and stops in the now-background chat-1.
        await act(async () => { await result.current.selectChat(CHAT_2); });
        await act(async () => { typingHandler(typing(CHAT_1, 'user-2', true)); });
        expect(result.current.typingUsers[CHAT_1]).toEqual({ 'user-2': { username: 'bob' } });

        await act(async () => { typingHandler(typing(CHAT_1, 'user-2', false)); });

        // Asserted over the whole map, not just the chat-1 slot: under the old
        // userId-only shape the entry lived at typingUsers['user-2'] and the
        // activeChat guard blocked the stop, so it stuck there forever.
        expect(result.current.typingUsers).toEqual({});
    });

    it('drops the chat key entirely once the last typist stops', async () => {
        const { result } = await renderChats();
        await act(async () => { await result.current.selectChat(CHAT_1); });

        await act(async () => {
            typingHandler(typing(CHAT_1, 'user-2', true));
            typingHandler(typing(CHAT_1, 'user-3', true));
        });
        expect(Object.keys(result.current.typingUsers[CHAT_1])).toHaveLength(2);

        await act(async () => {
            typingHandler(typing(CHAT_1, 'user-2', false));
            typingHandler(typing(CHAT_1, 'user-3', false));
        });

        expect(result.current.typingUsers[CHAT_1]).toBeUndefined();
    });

    it('ignores your own typing events', async () => {
        const { result } = await renderChats();
        await act(async () => { await result.current.selectChat(CHAT_1); });

        await act(async () => { typingHandler(typing(CHAT_1, 'user-1', true)); });

        expect(result.current.typingUsers).toEqual({});
    });

    // Safety net for a typist who disconnected without ever sending a stop.
    it('clears every indicator when you switch chats', async () => {
        const { result } = await renderChats();
        await act(async () => { await result.current.selectChat(CHAT_1); });
        await act(async () => { typingHandler(typing(CHAT_1, 'user-2', true)); });

        await act(async () => { await result.current.selectChat(CHAT_2); });

        expect(result.current.typingUsers).toEqual({});
    });
});
