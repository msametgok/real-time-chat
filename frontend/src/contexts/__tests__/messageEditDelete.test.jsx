import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture the handlers ChatContext registers so tests can play the server's
// side of the conversation.
let messageEditedHandler = null;
let messageDeletedForEveryoneHandler = null;
let messageDeletedForMeHandler = null;

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
        editMessage: vi.fn(() => true),
        deleteMessageForMe: vi.fn(() => true),
        deleteMessageForEveryone: vi.fn(() => true),
        onNewMessage: vi.fn(), offNewMessage: vi.fn(),
        onNewChat: vi.fn(), offNewChat: vi.fn(),
        onChatRestored: vi.fn(), offChatRestored: vi.fn(),
        onTyping: vi.fn(), offTyping: vi.fn(),
        onMessagesReadUpdate: vi.fn(), offMessagesReadUpdate: vi.fn(),
        onMessageDeliveryUpdate: vi.fn(), offMessageDeliveryUpdate: vi.fn(),
        onUserConnectedToChat: vi.fn(), offUserConnectedToChat: vi.fn(),
        onUserStatusUpdate: vi.fn(), offUserStatusUpdate: vi.fn(),
        onMessageSentAck: vi.fn(), offMessageSentAck: vi.fn(),
        onMessageEdited: vi.fn(cb => { messageEditedHandler = cb; }), offMessageEdited: vi.fn(),
        onMessageDeletedForEveryone: vi.fn(cb => { messageDeletedForEveryoneHandler = cb; }), offMessageDeletedForEveryone: vi.fn(),
        onMessageDeletedForMe: vi.fn(cb => { messageDeletedForMeHandler = cb; }), offMessageDeletedForMe: vi.fn(),
        onGroupUpdated: vi.fn(), offGroupUpdated: vi.fn(),
        onRemovedFromGroup: vi.fn(), offRemovedFromGroup: vi.fn(),
        onMessageError: vi.fn(), offMessageError: vi.fn(),
        onChatError: vi.fn(), offChatError: vi.fn(),
        onStatusError: vi.fn(), offStatusError: vi.fn(),
    }
}));

vi.mock('../../services/api', () => ({
    default: {
        getUserChats: vi.fn(() => Promise.resolve([])),
        getChatMessages: vi.fn(() => Promise.resolve({ messages: [] })),
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
const MSG_1 = 'msg-1';
const MSG_2 = 'msg-2';

const seedMessages = [
    { _id: MSG_1, chat: CHAT_1, sender: { _id: 'user-1', username: 'alice' }, messageType: 'text', content: 'first', createdAt: '2026-07-24T10:00:00Z', deliveredTo: [], readBy: [] },
    { _id: MSG_2, chat: CHAT_1, sender: { _id: 'user-2', username: 'bob' }, messageType: 'text', content: 'second', createdAt: '2026-07-24T10:01:00Z', deliveredTo: [], readBy: [] }
];

const renderWithOpenChat = async () => {
    api.getUserChats.mockResolvedValue([{
        _id: CHAT_1,
        isGroupChat: false,
        participants: [{ _id: 'user-1' }, { _id: 'user-2' }],
        latestMessage: { _id: MSG_2, messageType: 'text', content: 'second' },
        unreadCount: 0,
        updatedAt: '2026-07-24T10:01:00Z'
    }]);
    api.getChatMessages.mockResolvedValue({ messages: [...seedMessages] });

    const rendered = renderHook(() => useChat(), { wrapper });
    await waitFor(() => expect(rendered.result.current.chats).toHaveLength(1));
    await act(async () => { await rendered.result.current.selectChat(CHAT_1); });
    await waitFor(() => expect(rendered.result.current.messages).toHaveLength(2));
    return rendered;
};

beforeEach(() => {
    vi.clearAllMocks();
    messageEditedHandler = null;
    messageDeletedForEveryoneHandler = null;
    messageDeletedForMeHandler = null;
    socketService.editMessage.mockReturnValue(true);
    socketService.deleteMessageForMe.mockReturnValue(true);
    socketService.deleteMessageForEveryone.mockReturnValue(true);
});

describe('emitters', () => {
    it('editMessage trims and forwards to the socket', async () => {
        const { result } = await renderWithOpenChat();

        act(() => { result.current.editMessage(CHAT_1, MSG_1, '  better text  '); });

        expect(socketService.editMessage).toHaveBeenCalledWith(CHAT_1, MSG_1, 'better text');
    });

    it('surfaces a dropped edit emit instead of failing silently', async () => {
        socketService.editMessage.mockReturnValue(false);
        const { result } = await renderWithOpenChat();

        act(() => { result.current.editMessage(CHAT_1, MSG_1, 'never arrives'); });

        expect(result.current.messagesError).toMatch(/offline/i);
    });

    it('surfaces a dropped delete emit instead of failing silently', async () => {
        socketService.deleteMessageForEveryone.mockReturnValue(false);
        const { result } = await renderWithOpenChat();

        act(() => { result.current.deleteMessageForEveryone(CHAT_1, MSG_1); });

        expect(result.current.messagesError).toMatch(/offline/i);
    });
});

describe('messageEdited', () => {
    it('applies the new content and editedAt to the right message', async () => {
        const { result } = await renderWithOpenChat();

        act(() => messageEditedHandler({
            chatId: CHAT_1, messageId: MSG_1, content: 'edited!', editedAt: '2026-07-24T10:05:00Z'
        }));

        const edited = result.current.messages.find(m => m._id === MSG_1);
        expect(edited.content).toBe('edited!');
        expect(edited.editedAt).toBe('2026-07-24T10:05:00Z');
        // The other message is untouched.
        expect(result.current.messages.find(m => m._id === MSG_2).content).toBe('second');
    });

    it('updates the sidebar preview when the edited message is the latest', async () => {
        const { result } = await renderWithOpenChat();

        act(() => messageEditedHandler({
            chatId: CHAT_1, messageId: MSG_2, content: 'now different', editedAt: '2026-07-24T10:05:00Z'
        }));

        expect(result.current.chats[0].latestMessage.content).toBe('now different');
    });
});

describe('messageDeletedForEveryone', () => {
    it('turns the message into a payload-free tombstone', async () => {
        const { result } = await renderWithOpenChat();

        act(() => messageDeletedForEveryoneHandler({ chatId: CHAT_1, messageId: MSG_2 }));

        const tombstone = result.current.messages.find(m => m._id === MSG_2);
        expect(tombstone.isDeletedForEveryone).toBe(true);
        expect(tombstone.content).toBeUndefined();
        // The message stays in the list - the bubble renders the placeholder.
        expect(result.current.messages).toHaveLength(2);
    });

    it('tombstones the sidebar preview too', async () => {
        const { result } = await renderWithOpenChat();

        act(() => messageDeletedForEveryoneHandler({ chatId: CHAT_1, messageId: MSG_2 }));

        expect(result.current.chats[0].latestMessage.isDeletedForEveryone).toBe(true);
        expect(result.current.chats[0].latestMessage.content).toBeUndefined();
    });
});

describe('messageDeletedForMe', () => {
    it('removes the message from the open chat', async () => {
        const { result } = await renderWithOpenChat();

        act(() => messageDeletedForMeHandler({ chatId: CHAT_1, messageId: MSG_2 }));

        expect(result.current.messages).toHaveLength(1);
        expect(result.current.messages[0]._id).toBe(MSG_1);
    });
});
