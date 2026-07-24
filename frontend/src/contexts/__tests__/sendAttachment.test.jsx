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
        onChatRestored: vi.fn(), offChatRestored: vi.fn(),
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
        uploadChatFile: vi.fn(),
        resolveFileUrl: vi.fn(url => url),
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

const UPLOADED = {
    fileUrl: '/uploads/abc123.png',
    fileName: 'holiday.png',
    fileType: 'image/png',
    fileSize: 2048,
    messageType: 'image'
};

const makeFile = (name = 'holiday.png', type = 'image/png') =>
    new File(['data'], name, { type });

// Render with one chat, then open it so optimistic bubbles land in `messages`.
const renderWithOpenChat = async () => {
    api.getUserChats.mockResolvedValue([{
        _id: CHAT_1,
        isGroupChat: false,
        participants: [{ _id: 'user-1' }, { _id: 'user-2' }],
        unreadCount: 0,
        updatedAt: '2026-07-19T09:00:00Z'
    }]);

    const rendered = renderHook(() => useChat(), { wrapper });
    await waitFor(() => expect(rendered.result.current.chats).toHaveLength(1));

    await act(async () => { await rendered.result.current.selectChat(CHAT_1); });
    await waitFor(() => expect(rendered.result.current.activeChat?._id).toBe(CHAT_1));

    return rendered;
};

beforeEach(() => {
    vi.clearAllMocks();
    socketService.sendMessage.mockReturnValue(true);
    api.getChatMessages.mockResolvedValue({ messages: [] });
    // jsdom has neither; the attachment path needs both for image previews.
    URL.createObjectURL = vi.fn(() => 'blob:local-preview');
    URL.revokeObjectURL = vi.fn();
});

describe('sendAttachment', () => {
    it('shows an optimistic bubble immediately, then uploads and emits the server metadata', async () => {
        let resolveUpload;
        api.uploadChatFile.mockReturnValue(new Promise(res => { resolveUpload = res; }));
        const { result } = await renderWithOpenChat();

        act(() => result.current.sendAttachment(CHAT_1, makeFile()));

        // Before the upload finishes: bubble exists, marked sending, previews locally.
        const optimistic = result.current.messages.find(m => m.fileName === 'holiday.png');
        expect(optimistic).toBeTruthy();
        expect(optimistic.sending).toBe(true);
        expect(optimistic.localPreviewUrl).toBe('blob:local-preview');
        expect(socketService.sendMessage).not.toHaveBeenCalled();

        await act(async () => { resolveUpload(UPLOADED); });

        await waitFor(() =>
            expect(socketService.sendMessage).toHaveBeenCalledWith(
                expect.objectContaining({
                    chatId: CHAT_1,
                    tempId: optimistic._id,
                    ...UPLOADED
                })
            )
        );
    });

    it('sends the caption as content, trimmed, on bubble and emit alike', async () => {
        api.uploadChatFile.mockResolvedValue(UPLOADED);
        const { result } = await renderWithOpenChat();

        act(() => result.current.sendAttachment(CHAT_1, makeFile(), '  look at this  '));

        expect(
            result.current.messages.find(m => m.fileName === 'holiday.png').content
        ).toBe('look at this');

        await waitFor(() =>
            expect(socketService.sendMessage).toHaveBeenCalledWith(
                expect.objectContaining({ content: 'look at this', fileUrl: UPLOADED.fileUrl })
            )
        );
    });

    it('previews the sidebar with the file name', async () => {
        api.uploadChatFile.mockResolvedValue(UPLOADED);
        const { result } = await renderWithOpenChat();

        act(() => result.current.sendAttachment(CHAT_1, makeFile()));

        expect(result.current.chats[0].latestMessage.fileName).toBe('holiday.png');
    });

    it('marks the bubble failed when the upload fails', async () => {
        api.uploadChatFile.mockRejectedValue(new Error('too big'));
        const { result } = await renderWithOpenChat();

        act(() => result.current.sendAttachment(CHAT_1, makeFile()));

        await waitFor(() => {
            const bubble = result.current.messages.find(m => m.fileName === 'holiday.png');
            expect(bubble.failed).toBe(true);
            expect(bubble.sending).toBe(false);
        });
        expect(result.current.messagesError).toBe('too big');
        expect(socketService.sendMessage).not.toHaveBeenCalled();
    });

    it('re-uploads on retry when the upload never completed', async () => {
        api.uploadChatFile.mockRejectedValueOnce(new Error('network'));
        const { result } = await renderWithOpenChat();

        act(() => result.current.sendAttachment(CHAT_1, makeFile()));
        await waitFor(() =>
            expect(result.current.messages.find(m => m.fileName === 'holiday.png').failed).toBe(true)
        );

        api.uploadChatFile.mockResolvedValue(UPLOADED);
        const tempId = result.current.messages.find(m => m.fileName === 'holiday.png')._id;
        act(() => result.current.retryMessage(tempId));

        await waitFor(() =>
            expect(socketService.sendMessage).toHaveBeenCalledWith(
                expect.objectContaining({ tempId, fileUrl: UPLOADED.fileUrl })
            )
        );
        expect(api.uploadChatFile).toHaveBeenCalledTimes(2);
    });

    // The upload succeeded but the socket emit was dropped: the file is
    // already on the server, so a retry must NOT upload it a second time.
    it('skips the re-upload on retry when only the emit was dropped', async () => {
        api.uploadChatFile.mockResolvedValue(UPLOADED);
        socketService.sendMessage.mockReturnValue(false);
        const { result } = await renderWithOpenChat();

        act(() => result.current.sendAttachment(CHAT_1, makeFile()));
        await waitFor(() =>
            expect(result.current.messages.find(m => m.fileName === 'holiday.png').failed).toBe(true)
        );

        socketService.sendMessage.mockReturnValue(true);
        const tempId = result.current.messages.find(m => m.fileName === 'holiday.png')._id;
        act(() => result.current.retryMessage(tempId));

        await waitFor(() =>
            expect(socketService.sendMessage).toHaveBeenLastCalledWith(
                expect.objectContaining({ tempId, fileUrl: UPLOADED.fileUrl, messageType: 'image' })
            )
        );
        expect(api.uploadChatFile).toHaveBeenCalledTimes(1);
    });
});
