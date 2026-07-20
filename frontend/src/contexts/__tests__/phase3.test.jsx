import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Captured handlers, so tests drive ChatContext directly instead of standing
// up a real socket.
let typingHandler = null;
let newChatHandler = null;

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
        markChatAsRead: vi.fn(),
        messageDeliveredToClient: vi.fn(),
        onNewMessage: vi.fn(), offNewMessage: vi.fn(),
        onNewChat: vi.fn(cb => { newChatHandler = cb; }), offNewChat: vi.fn(),
        onTyping: vi.fn(cb => { typingHandler = cb; }), offTyping: vi.fn(),
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

const msg = (id, chatId, content) => ({
    _id: id,
    chat: chatId,
    sender: { _id: 'user-2', username: 'bob' },
    messageType: 'text',
    content,
    deliveredTo: ['user-1'],
    readBy: [],
    createdAt: '2026-07-19T10:00:00Z'
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
    newChatHandler = null;
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

describe('selectChat race', () => {
    // Clicking chat-1 then chat-2 fast leaves two fetches in flight. Without a
    // guard the slower (chat-1) response resolves last and writes A's messages
    // into B's open window.
    it('drops a superseded response instead of writing it into the new chat', async () => {
        const { result } = await renderChats();

        let releaseSlow;
        const slow = new Promise(resolve => { releaseSlow = resolve; });

        api.getChatMessages.mockImplementation(chatId =>
            chatId === CHAT_1
                ? slow.then(() => ({ messages: [msg('m-old', CHAT_1, 'from chat one')] }))
                : Promise.resolve({ messages: [msg('m-new', CHAT_2, 'from chat two')] })
        );

        // Start chat-1's fetch but don't let it finish; then switch to chat-2.
        let firstSelect;
        await act(async () => { firstSelect = result.current.selectChat(CHAT_1); });
        await act(async () => { await result.current.selectChat(CHAT_2); });

        // chat-1's response only lands now - too late to be allowed to write.
        await act(async () => { releaseSlow(); await firstSelect; });

        expect(result.current.activeChat?._id).toBe(CHAT_2);
        expect(result.current.messages.map(m => m._id)).toEqual(['m-new']);
    });

    it('leaves the loading flag owned by the newest fetch', async () => {
        const { result } = await renderChats();

        let releaseSlow;
        const slow = new Promise(resolve => { releaseSlow = resolve; });
        api.getChatMessages.mockImplementation(chatId =>
            chatId === CHAT_1
                ? slow.then(() => ({ messages: [] }))
                : Promise.resolve({ messages: [] })
        );

        let firstSelect;
        await act(async () => { firstSelect = result.current.selectChat(CHAT_1); });
        await act(async () => { await result.current.selectChat(CHAT_2); });
        await act(async () => { releaseSlow(); await firstSelect; });

        expect(result.current.isLoadingMessages).toBe(false);
    });
});

describe('newChat', () => {
    // Chat creation is an HTTP call on the creator's side, so without this
    // event the recipient sees nothing until a manual reload.
    it('prepends a chat created by someone else', async () => {
        const { result } = await renderChats();

        await act(async () => {
            newChatHandler(chatFixture('chat-3', '2026-07-19T12:00:00Z'));
        });

        expect(result.current.chats).toHaveLength(3);
        expect(result.current.chats[0]._id).toBe('chat-3');
    });

    it('does not duplicate a chat already in the list', async () => {
        const { result } = await renderChats();

        await act(async () => {
            newChatHandler(chatFixture(CHAT_1, '2026-07-19T12:00:00Z'));
        });

        expect(result.current.chats).toHaveLength(2);
    });

    it('defaults unreadCount so the badge does not render NaN', async () => {
        const { result } = await renderChats();

        await act(async () => {
            // Destructured only to omit it from the payload - the underscore
            // matches eslint's varsIgnorePattern for a deliberately unused var.
            const { unreadCount: _unreadCount, ...withoutCount } = chatFixture('chat-3', '2026-07-19T12:00:00Z');
            newChatHandler(withoutCount);
        });

        expect(result.current.chats.find(c => c._id === 'chat-3').unreadCount).toBe(0);
    });
});
