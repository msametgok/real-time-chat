import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Captures the handler ChatContext registers, so tests can drive it directly
// rather than standing up a real socket.
let newMessageHandler = null;

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
        onNewMessage: vi.fn(cb => { newMessageHandler = cb; }),
        offNewMessage: vi.fn(),
        onNewChat: vi.fn(), offNewChat: vi.fn(),
        onTyping: vi.fn(), offTyping: vi.fn(),
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

import socketService from '../../services/socket';
import api from '../../services/api';
import { ChatProvider } from '../ChatContext';
import { useChat } from '../../hooks/useChat';

const wrapper = ({ children }) => <ChatProvider>{children}</ChatProvider>;

const ACTIVE_ID = 'chat-active';
const OTHER_ID = 'chat-other';

const chatFixture = (id, updatedAt) => ({
    _id: id,
    isGroupChat: false,
    participants: [{ _id: 'user-1' }, { _id: 'user-2' }],
    unreadCount: 0,
    updatedAt
});

const incoming = (chatId, senderId, content, createdAt = '2026-07-19T10:00:00Z') => ({
    _id: `msg-${content}-${chatId}`,
    chat: chatId,
    sender: { _id: senderId, username: senderId === 'user-1' ? 'alice' : 'bob' },
    messageType: 'text',
    content,
    deliveredTo: ['user-1'],
    readBy: [],
    createdAt
});

const renderChats = async () => {
    api.getUserChats.mockResolvedValue([
        chatFixture(ACTIVE_ID, '2026-07-19T09:00:00Z'),
        chatFixture(OTHER_ID, '2026-07-19T08:00:00Z')
    ]);

    const rendered = renderHook(() => useChat(), { wrapper });
    await waitFor(() => expect(rendered.result.current.chats).toHaveLength(2));
    await act(async () => { await rendered.result.current.selectChat(ACTIVE_ID); });
    await waitFor(() => expect(rendered.result.current.activeChat?._id).toBe(ACTIVE_ID));

    return rendered;
};

const unreadFor = (result, chatId) =>
    result.current.chats.find(c => c._id === chatId)?.unreadCount ?? 0;

describe('unread badge counting', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        newMessageHandler = null;
        socketService.sendMessage.mockReturnValue(true);
        api.getChatMessages.mockResolvedValue({ messages: [] });
    });

    // The core Phase 2 regression: newMessage AND two chatListUpdate emits each
    // incremented, so a single message raised the badge by three.
    it('increments by exactly ONE per incoming message', async () => {
        const { result } = await renderChats();

        await act(async () => {
            newMessageHandler(incoming(OTHER_ID, 'user-2', 'hi'));
        });

        expect(unreadFor(result, OTHER_ID)).toBe(1);
    });

    it('counts each of three distinct messages once', async () => {
        const { result } = await renderChats();

        await act(async () => {
            newMessageHandler(incoming(OTHER_ID, 'user-2', 'one'));
            newMessageHandler(incoming(OTHER_ID, 'user-2', 'two'));
            newMessageHandler(incoming(OTHER_ID, 'user-2', 'three'));
        });

        expect(unreadFor(result, OTHER_ID)).toBe(3);
    });

    // Previously the increment had no sender check, so your own sends raised
    // your own badge.
    it('does not count your own message as unread', async () => {
        const { result } = await renderChats();

        await act(async () => {
            newMessageHandler(incoming(OTHER_ID, 'user-1', 'mine'));
        });

        expect(unreadFor(result, OTHER_ID)).toBe(0);
    });

    it('does not count messages arriving in the chat you are viewing', async () => {
        const { result } = await renderChats();

        await act(async () => {
            newMessageHandler(incoming(ACTIVE_ID, 'user-2', 'visible'));
        });

        expect(unreadFor(result, ACTIVE_ID)).toBe(0);
    });

    it('clears the badge when you open the chat', async () => {
        const { result } = await renderChats();

        await act(async () => {
            newMessageHandler(incoming(OTHER_ID, 'user-2', 'one'));
            newMessageHandler(incoming(OTHER_ID, 'user-2', 'two'));
        });
        expect(unreadFor(result, OTHER_ID)).toBe(2);

        await act(async () => { await result.current.selectChat(OTHER_ID); });

        expect(unreadFor(result, OTHER_ID)).toBe(0);
    });

    it('still updates the preview and ordering for the muted own-message case', async () => {
        const { result } = await renderChats();

        await act(async () => {
            newMessageHandler(incoming(OTHER_ID, 'user-1', 'mine', '2026-07-19T12:00:00Z'));
        });

        const other = result.current.chats.find(c => c._id === OTHER_ID);
        expect(other.latestMessage.content).toBe('mine');
        // Newest chat sorts to the top even though it added no unread.
        expect(result.current.chats[0]._id).toBe(OTHER_ID);
    });
});

describe('active-chat message list', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        newMessageHandler = null;
        api.getChatMessages.mockResolvedValue({ messages: [] });
    });

    it('appends an incoming message to the open chat', async () => {
        const { result } = await renderChats();

        await act(async () => {
            newMessageHandler(incoming(ACTIVE_ID, 'user-2', 'hello'));
        });

        expect(result.current.messages).toHaveLength(1);
        expect(result.current.messages[0].content).toBe('hello');
    });

    it('does not duplicate a message it already has', async () => {
        const { result } = await renderChats();
        const msg = incoming(ACTIVE_ID, 'user-2', 'hello');

        await act(async () => {
            newMessageHandler(msg);
            newMessageHandler(msg);
        });

        expect(result.current.messages).toHaveLength(1);
    });

    // The deleted content-match heuristic scanned backwards for an optimistic
    // bubble with matching text, so the same text sent twice landed reversed.
    it('keeps two same-text messages in arrival order', async () => {
        const { result } = await renderChats();

        await act(async () => {
            newMessageHandler({
                ...incoming(ACTIVE_ID, 'user-2', 'ok'),
                _id: 'msg-first',
                createdAt: '2026-07-19T10:00:00Z'
            });
            newMessageHandler({
                ...incoming(ACTIVE_ID, 'user-2', 'ok'),
                _id: 'msg-second',
                createdAt: '2026-07-19T10:00:01Z'
            });
        });

        expect(result.current.messages.map(m => m._id)).toEqual(['msg-first', 'msg-second']);
    });
});
