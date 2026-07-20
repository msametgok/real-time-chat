import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks must be declared before the modules under test are imported ───
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

// NOTE: getUserChats resolves to a bare ARRAY (see fetchChats in ChatContext),
// not { chats: [...] }.
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

const CHAT_ID = 'chat-1';
const CHAT = {
    _id: CHAT_ID,
    isGroupChat: false,
    participants: [{ _id: 'user-1' }, { _id: 'user-2' }],
    updatedAt: '2026-07-18T09:00:00Z'
};

/**
 * Render the hook with CHAT_ID already active - sendMessage only pushes an
 * optimistic bubble into `messages` for the currently open chat.
 */
const renderChat = async () => {
    api.getUserChats.mockResolvedValue([CHAT]);
    const rendered = renderHook(() => useChat(), { wrapper });

    await waitFor(() => expect(rendered.result.current.chats).toHaveLength(1));
    await act(async () => { await rendered.result.current.selectChat(CHAT_ID); });
    await waitFor(() => expect(rendered.result.current.activeChat?._id).toBe(CHAT_ID));

    return rendered;
};

/** Send one message that fails because the socket is down. */
const sendFailing = async (result) => {
    socketService.sendMessage.mockReturnValue(false);
    await act(async () => {
        result.current.sendMessage({
            chatId: CHAT_ID,
            content: 'hello',
            messageType: 'text',
            tempId: 'temp-1'
        });
    });
};

describe('retryMessage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        socketService.sendMessage.mockReturnValue(true);
        api.getChatMessages.mockResolvedValue({ messages: [] });
        
    });

    it('marks a message failed when the socket is down', async () => {
        const { result } = await renderChat();
        await sendFailing(result);

        const msg = result.current.messages.find(m => m._id === 'temp-1');
        expect(msg).toBeDefined();
        expect(msg.failed).toBe(true);
        expect(msg.sending).toBe(false);
    });

    // Regression: retryMessage read its target from inside a setMessages
    // updater. React defers updaters to render time, so the target was always
    // undefined and the function bailed out BEFORE emitting - leaving the
    // bubble in a non-failed state that rendered as a single "sent" tick.
    it('actually re-emits when retried', async () => {
        const { result } = await renderChat();
        await sendFailing(result);

        socketService.sendMessage.mockClear();
        socketService.sendMessage.mockReturnValue(true);

        await act(async () => { result.current.retryMessage('temp-1'); });

        expect(socketService.sendMessage).toHaveBeenCalledTimes(1);
        expect(socketService.sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({ chatId: CHAT_ID, content: 'hello', tempId: 'temp-1' })
        );
    });

    it('reuses the same tempId so the bubble is reconciled, not duplicated', async () => {
        const { result } = await renderChat();
        await sendFailing(result);

        socketService.sendMessage.mockClear();
        await act(async () => { result.current.retryMessage('temp-1'); });

        expect(socketService.sendMessage.mock.calls[0][0].tempId).toBe('temp-1');
        expect(result.current.messages.filter(m => m._id === 'temp-1')).toHaveLength(1);
    });

    it('clears the failed flag while the retry is in flight', async () => {
        const { result } = await renderChat();
        await sendFailing(result);

        socketService.sendMessage.mockReturnValue(true);
        await act(async () => { result.current.retryMessage('temp-1'); });

        const msg = result.current.messages.find(m => m._id === 'temp-1');
        expect(msg.failed).toBe(false);
        expect(msg.sending).toBe(true);
    });

    // Retrying while STILL offline must land back in the failed state, not sit
    // in a pending state that renders as a delivered-looking tick.
    it('returns to failed when the retry also fails', async () => {
        const { result } = await renderChat();
        await sendFailing(result);

        socketService.sendMessage.mockReturnValue(false); // still down
        await act(async () => { result.current.retryMessage('temp-1'); });

        const msg = result.current.messages.find(m => m._id === 'temp-1');
        expect(msg.failed).toBe(true);
        expect(msg.sending).toBe(false);
    });

    it('is a no-op for an unknown tempId', async () => {
        const { result } = await renderChat();
        await sendFailing(result);

        socketService.sendMessage.mockClear();
        await act(async () => { result.current.retryMessage('does-not-exist'); });

        expect(socketService.sendMessage).not.toHaveBeenCalled();
    });
});

describe('fetchMessages preserves local-only messages', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        socketService.sendMessage.mockReturnValue(true);
        
    });

    // Regression: the reconnect resync calls fetchMessages, which replaced the
    // whole array with server data. Failed sends were never persisted, so they
    // vanished from the UI the moment the connection came back.
    it('keeps a failed message when the server returns without it', async () => {
        const { result } = await renderChat();
        await sendFailing(result);

        api.getChatMessages.mockResolvedValue({
            messages: [
                { _id: 'server-1', content: 'from server', chat: CHAT_ID,
                  sender: { _id: 'user-2' }, createdAt: '2026-07-18T10:00:00Z',
                  deliveredTo: [], readBy: [] }
            ]
        });

        await act(async () => { await result.current.fetchMessages(CHAT_ID); });

        await waitFor(() => {
            expect(result.current.messages.some(m => m._id === 'server-1')).toBe(true);
        });
        const failed = result.current.messages.find(m => m._id === 'temp-1');
        expect(failed).toBeDefined();
        expect(failed.failed).toBe(true);
    });

    it('does not duplicate a message the server now knows about', async () => {
        const { result } = await renderChat();
        await sendFailing(result);

        // Server now returns the message under the same id
        api.getChatMessages.mockResolvedValue({
            messages: [
                { _id: 'temp-1', content: 'hello', chat: CHAT_ID,
                  sender: { _id: 'user-1' }, createdAt: '2026-07-18T10:00:00Z',
                  deliveredTo: [], readBy: [] }
            ]
        });

        await act(async () => { await result.current.fetchMessages(CHAT_ID); });

        expect(result.current.messages.filter(m => m._id === 'temp-1')).toHaveLength(1);
    });

    it('drops nothing when there are no local-only messages', async () => {
        const { result } = await renderChat();

        api.getChatMessages.mockResolvedValue({
            messages: [
                { _id: 'server-1', content: 'a', chat: CHAT_ID,
                  sender: { _id: 'user-2' }, createdAt: '2026-07-18T10:00:00Z',
                  deliveredTo: [], readBy: [] }
            ]
        });

        await act(async () => { await result.current.fetchMessages(CHAT_ID); });

        expect(result.current.messages).toHaveLength(1);
    });
});
