import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// A fake raw socket, since these tests fire 'disconnect'/'connect' on the
// socket itself rather than through the eventCallbacks indirection.
const fakeSocket = {
    handlers: {},
    on: vi.fn((event, cb) => { (fakeSocket.handlers[event] ||= []).push(cb); }),
    off: vi.fn((event, cb) => {
        fakeSocket.handlers[event] = (fakeSocket.handlers[event] || []).filter(h => h !== cb);
    }),
    fire: (event, ...args) => (fakeSocket.handlers[event] || []).forEach(h => h(...args)),
};

vi.mock('../../services/socket', () => ({
    default: {
        sendMessage: vi.fn(() => true),
        connect: vi.fn(() => Promise.resolve()),
        disconnect: vi.fn(),
        getSocket: vi.fn(() => fakeSocket),
        joinChat: vi.fn(),
        leaveChat: vi.fn(),
        typingStart: vi.fn(),
        typingStop: vi.fn(),
        markMessagesAsRead: vi.fn(),
        markChatAsRead: vi.fn(),
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

const CHAT = {
    _id: 'chat-1',
    isGroupChat: false,
    participants: [{ _id: 'user-1' }, { _id: 'user-2' }],
    unreadCount: 0,
    updatedAt: '2026-07-19T09:00:00Z'
};

const renderConnected = async () => {
    api.getUserChats.mockResolvedValue([CHAT]);
    const rendered = renderHook(() => useChat(), { wrapper });
    await waitFor(() => expect(rendered.result.current.hasConnected).toBe(true));
    await waitFor(() => expect(fakeSocket.handlers.disconnect?.length).toBeGreaterThan(0));
    return rendered;
};

beforeEach(() => {
    vi.clearAllMocks();
    fakeSocket.handlers = {};
    api.getChatMessages.mockResolvedValue({ messages: [] });
});

// The connect effect is gated on `!hasConnected`, so a socket that dies after
// connecting never went through it. Before the fix nothing set connectionError
// and the UI was indistinguishable from a healthy one while every emit was
// being silently dropped.
describe('mid-session socket loss', () => {
    it('surfaces a transport drop as connectionError', async () => {
        const { result } = await renderConnected();
        expect(result.current.connectionError).toBeNull();

        act(() => fakeSocket.fire('disconnect', 'transport close'));

        await waitFor(() => expect(result.current.connectionError).toBeTruthy());
        // socket.io retries this one itself; we must not tear down our state.
        expect(result.current.hasConnected).toBe(true);
    });

    it('clears the error when the socket comes back', async () => {
        const { result } = await renderConnected();

        act(() => fakeSocket.fire('disconnect', 'ping timeout'));
        await waitFor(() => expect(result.current.connectionError).toBeTruthy());

        await act(async () => { fakeSocket.fire('connect'); });

        await waitFor(() => expect(result.current.connectionError).toBeNull());
    });

    // 'io server disconnect' is the one reason socket.io will NOT retry on its
    // own, so we have to hand it back to the connect effect's backoff loop.
    it('drops hasConnected when the server ends the session', async () => {
        const { result } = await renderConnected();
        socketService.connect.mockClear();

        act(() => fakeSocket.fire('disconnect', 'io server disconnect'));

        await waitFor(() => expect(result.current.connectionError).toBeTruthy());
        await waitFor(() => expect(socketService.connect).toHaveBeenCalled());
    });

    // Logout calls socketService.disconnect(), which fires this same event.
    // Reporting an outage there would leave a banner over the login screen.
    it('ignores a disconnect we initiated ourselves', async () => {
        const { result } = await renderConnected();

        act(() => fakeSocket.fire('disconnect', 'io client disconnect'));

        expect(result.current.connectionError).toBeNull();
    });
});
