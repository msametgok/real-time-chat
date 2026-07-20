import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture the handlers ChatContext registers so tests can fire server errors
// without a real socket.
let chatErrorHandler = null;
let statusErrorHandler = null;
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
        messageDeliveredToClient: vi.fn(),
        onNewMessage: vi.fn(), offNewMessage: vi.fn(),
        onNewChat: vi.fn(cb => { newChatHandler = cb; }), offNewChat: vi.fn(),
        onTyping: vi.fn(), offTyping: vi.fn(),
        onMessagesReadUpdate: vi.fn(), offMessagesReadUpdate: vi.fn(),
        onMessageDeliveryUpdate: vi.fn(), offMessageDeliveryUpdate: vi.fn(),
        onUserConnectedToChat: vi.fn(), offUserConnectedToChat: vi.fn(),
        onUserStatusUpdate: vi.fn(), offUserStatusUpdate: vi.fn(),
        onMessageSentAck: vi.fn(), offMessageSentAck: vi.fn(),
        onMessageError: vi.fn(), offMessageError: vi.fn(),
        onChatError: vi.fn(cb => { chatErrorHandler = cb; }), offChatError: vi.fn(),
        onStatusError: vi.fn(cb => { statusErrorHandler = cb; }), offStatusError: vi.fn(),
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

const CHAT_1 = 'chat-1';
const CHAT_2 = 'chat-2';

const chatFixture = (id, updatedAt) => ({
    _id: id,
    isGroupChat: false,
    participants: [{ _id: 'user-1' }, { _id: 'user-2' }],
    unreadCount: 0,
    updatedAt
});

// Render, wait for the chat list, then wait for the join effect to have run so
// the "already joined" bookkeeping is populated before each test acts.
const renderConnected = async () => {
    api.getUserChats.mockResolvedValue([
        chatFixture(CHAT_1, '2026-07-19T09:00:00Z'),
        chatFixture(CHAT_2, '2026-07-19T08:00:00Z')
    ]);

    const rendered = renderHook(() => useChat(), { wrapper });
    await waitFor(() => expect(rendered.result.current.chats).toHaveLength(2));
    await waitFor(() => expect(socketService.joinChat).toHaveBeenCalledWith(CHAT_1));
    await waitFor(() => expect(socketService.joinChat).toHaveBeenCalledWith(CHAT_2));
    return rendered;
};

const joinCallsFor = chatId =>
    socketService.joinChat.mock.calls.filter(([id]) => id === chatId).length;

beforeEach(() => {
    vi.clearAllMocks();
    chatErrorHandler = null;
    statusErrorHandler = null;
    newChatHandler = null;
    api.getChatMessages.mockResolvedValue({ messages: [] });
});

describe('chatError', () => {
    it('registers a listener at all', async () => {
        await renderConnected();
        expect(socketService.onChatError).toHaveBeenCalled();
        expect(typeof chatErrorHandler).toBe('function');
    });

    // The bookkeeping half of the gap, and the one with lasting consequences:
    // joinedChatsRef records the id optimistically when joinChat is emitted. If
    // a rejected join leaves the id in that set, the join effect treats the
    // room as joined forever and the chat receives no realtime updates for the
    // rest of the session.
    it('re-attempts a join that the server rejected', async () => {
        const { result } = await renderConnected();
        expect(joinCallsFor(CHAT_1)).toBe(1);

        act(() => chatErrorHandler({ chatId: CHAT_1, message: 'Access denied.' }));

        // Any change to `chats` re-runs the join effect.
        act(() => newChatHandler({
            _id: 'chat-3',
            participants: [{ _id: 'user-1' }, { _id: 'user-3' }],
            updatedAt: '2026-07-19T11:00:00Z'
        }));

        await waitFor(() => expect(joinCallsFor(CHAT_1)).toBe(2));
        // The chat that never failed must not be re-joined.
        expect(joinCallsFor(CHAT_2)).toBe(1);
        expect(result.current.chats).toHaveLength(3);
    });

    it('surfaces the server message', async () => {
        const { result } = await renderConnected();

        act(() => chatErrorHandler({ chatId: CHAT_1, message: 'Access denied.' }));

        await waitFor(() =>
            expect(result.current.realtimeError?.message).toBe('Access denied.')
        );
    });

    // ChatList renders `chatError` *instead of* the sidebar. A transient socket
    // failure must not blank the chat list.
    it('does not disturb the chat list or its error state', async () => {
        const { result } = await renderConnected();

        act(() => chatErrorHandler({ chatId: CHAT_1, message: 'Access denied.' }));

        expect(result.current.chatError).toBeNull();
        expect(result.current.chats).toHaveLength(2);
    });

    it('tolerates a payload with no chatId', async () => {
        const { result } = await renderConnected();

        act(() => chatErrorHandler({ message: 'Chat ID is required to join.' }));

        await waitFor(() =>
            expect(result.current.realtimeError?.message).toBe('Chat ID is required to join.')
        );
    });
});

describe('statusError', () => {
    it('registers a listener at all', async () => {
        await renderConnected();
        expect(socketService.onStatusError).toHaveBeenCalled();
        expect(typeof statusErrorHandler).toBe('function');
    });

    it('surfaces the server message', async () => {
        const { result } = await renderConnected();

        act(() => statusErrorHandler({
            chatId: CHAT_1,
            message: 'Failed to mark messages as read.'
        }));

        await waitFor(() =>
            expect(result.current.realtimeError?.message).toBe('Failed to mark messages as read.')
        );
    });

    it('falls back to a generic message when the server sends none', async () => {
        const { result } = await renderConnected();

        act(() => statusErrorHandler({ chatId: CHAT_1 }));

        await waitFor(() => expect(result.current.realtimeError?.message).toBeTruthy());
    });
});

describe('realtimeError', () => {
    it('can be dismissed', async () => {
        const { result } = await renderConnected();

        act(() => statusErrorHandler({ message: 'boom' }));
        await waitFor(() => expect(result.current.realtimeError).not.toBeNull());

        act(() => result.current.dismissRealtimeError());
        expect(result.current.realtimeError).toBeNull();
    });

    // The banner's auto-dismiss timer keys off `key`, not the text. Without a
    // changing key an identical repeat is a no-op state update and the second
    // failure would inherit the first one's already-running countdown.
    it('bumps key when the same message repeats', async () => {
        const { result } = await renderConnected();

        act(() => statusErrorHandler({ message: 'same' }));
        const first = result.current.realtimeError.key;

        act(() => statusErrorHandler({ message: 'same' }));
        expect(result.current.realtimeError.key).not.toBe(first);
        expect(result.current.realtimeError.message).toBe('same');
    });
});
