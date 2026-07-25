import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

let groupUpdatedHandler = null;
let removedFromGroupHandler = null;

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
        onChatRestored: vi.fn(), offChatRestored: vi.fn(),
        onTyping: vi.fn(), offTyping: vi.fn(),
        onMessagesReadUpdate: vi.fn(), offMessagesReadUpdate: vi.fn(),
        onMessageDeliveryUpdate: vi.fn(), offMessageDeliveryUpdate: vi.fn(),
        onUserConnectedToChat: vi.fn(), offUserConnectedToChat: vi.fn(),
        onUserStatusUpdate: vi.fn(), offUserStatusUpdate: vi.fn(),
        onMessageSentAck: vi.fn(), offMessageSentAck: vi.fn(),
        onMessageEdited: vi.fn(), offMessageEdited: vi.fn(),
        onMessageDeletedForEveryone: vi.fn(), offMessageDeletedForEveryone: vi.fn(),
        onMessageDeletedForMe: vi.fn(), offMessageDeletedForMe: vi.fn(),
        onGroupUpdated: vi.fn(cb => { groupUpdatedHandler = cb; }), offGroupUpdated: vi.fn(),
        onRemovedFromGroup: vi.fn(cb => { removedFromGroupHandler = cb; }), offRemovedFromGroup: vi.fn(),
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

import api from '../../services/api';
import { ChatProvider } from '../ChatContext';
import { useChat } from '../../hooks/useChat';

const wrapper = ({ children }) => <ChatProvider>{children}</ChatProvider>;

const GROUP_ID = 'group-1';
const OTHER_ID = 'chat-2';

const groupFixture = (chatName) => ({
    _id: GROUP_ID,
    isGroupChat: true,
    chatName,
    displayChatName: chatName,
    participants: [{ _id: 'user-1' }, { _id: 'user-2' }, { _id: 'user-3' }],
    groupAdmin: { _id: 'user-2', username: 'bob' },
    unreadCount: 0,
    updatedAt: '2026-07-24T09:00:00Z'
});

const otherChat = {
    _id: OTHER_ID,
    isGroupChat: false,
    participants: [{ _id: 'user-1' }, { _id: 'user-2' }],
    unreadCount: 0,
    updatedAt: '2026-07-24T08:00:00Z'
};

const renderWithGroupOpen = async () => {
    api.getUserChats.mockResolvedValue([groupFixture('Old name'), otherChat]);
    const rendered = renderHook(() => useChat(), { wrapper });
    await waitFor(() => expect(rendered.result.current.chats).toHaveLength(2));
    await act(async () => { await rendered.result.current.selectChat(GROUP_ID); });
    await waitFor(() => expect(rendered.result.current.activeChat?._id).toBe(GROUP_ID));
    return rendered;
};

beforeEach(() => {
    vi.clearAllMocks();
    groupUpdatedHandler = null;
    removedFromGroupHandler = null;
    api.getChatMessages.mockResolvedValue({ messages: [] });
});

describe('groupUpdated', () => {
    it('refetches and refreshes the OPEN chat, not just the sidebar', async () => {
        const { result } = await renderWithGroupOpen();

        // The next fetch returns the renamed group.
        api.getUserChats.mockResolvedValue([groupFixture('New name'), otherChat]);

        await act(async () => { await groupUpdatedHandler({ chatId: GROUP_ID }); });

        await waitFor(() => {
            expect(result.current.chats.find(c => c._id === GROUP_ID).chatName).toBe('New name');
            // The header renders from activeChat - a stale snapshot here means
            // the rename is invisible until the user switches chats.
            expect(result.current.activeChat.chatName).toBe('New name');
        });
    });

    it('leaves activeChat alone when a DIFFERENT group changed', async () => {
        const { result } = await renderWithGroupOpen();
        const activeBefore = result.current.activeChat;

        api.getUserChats.mockResolvedValue([groupFixture('Old name'), otherChat]);
        await act(async () => { await groupUpdatedHandler({ chatId: OTHER_ID }); });

        expect(result.current.activeChat).toBe(activeBefore);
    });
});

describe('removedFromGroup', () => {
    it('drops the chat and closes it if it was open', async () => {
        const { result } = await renderWithGroupOpen();

        act(() => removedFromGroupHandler({ chatId: GROUP_ID }));

        expect(result.current.chats.map(c => c._id)).toEqual([OTHER_ID]);
        expect(result.current.activeChat).toBeNull();
        expect(result.current.messages).toEqual([]);
    });

    it('leaves the open chat alone when removed from a background group', async () => {
        api.getUserChats.mockResolvedValue([groupFixture('Old name'), otherChat]);
        const rendered = renderHook(() => useChat(), { wrapper });
        await waitFor(() => expect(rendered.result.current.chats).toHaveLength(2));
        await act(async () => { await rendered.result.current.selectChat(OTHER_ID); });
        await waitFor(() => expect(rendered.result.current.activeChat?._id).toBe(OTHER_ID));

        act(() => removedFromGroupHandler({ chatId: GROUP_ID }));

        expect(rendered.result.current.chats.map(c => c._id)).toEqual([OTHER_ID]);
        expect(rendered.result.current.activeChat?._id).toBe(OTHER_ID);
    });
});
