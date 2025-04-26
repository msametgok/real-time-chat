const Chat = require('../models/Chat');
const Message = require('../models/Message');
const User = require('../models/User');

exports.createChat = async (req, res) => {
    try {
        let { participantIds } = req.body; // Array of user IDs to chat with
        const userId = req.user.userId; //from JWT

        console.log(req.body);
        
        // Valdiate participantIds
        if (!Array.isArray(participantIds) || participantIds.length === 0) {
            return res.status(400).json({ message: 'Invalid participant IDs' });
        }
        
        const users = await User.find({ _id: { $in: participantIds } });

        if (users.length !== participantIds.length) {
            return res.status(404).json({ message: 'One or more participant IDs are invalid' });
        }

        if (participantIds.includes(userId)) {
            return res.status(400).json({ message: 'Cannot include self in participantIds' });
        }

        let chat = await Chat.findOne({ participants: { $all: [userId, ...participantIds] } });

        if (!chat) {
            chat = new Chat({ participants: [userId, ...participantIds] });
            await chat.save();
        }

        res.status(201).json({chatId: chat._id});
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message});
    }
}

// Create Group Chat
exports.createGroupChat = async (req, res) => {
    try {
        const { participantIds, chatName } = req.body;
        const userId = req.user.userId;

        //Validate inputs
        if (!chatName || typeof chatName !== 'string' || chatName.trim().length === 0) {
            return res.status(400).json({ message: 'Chat name is required and must be a non-empty string' });
        }

        if (!Array.isArray(participantIds) || participantIds.length === 0) {
            return res.status(400).json({ message: 'participantIds must be a non-empty array' });
        }

        const users = await User.find({ _id: {$in: participantIds} });

        if (users.length !== participantIds.length) {
            return res.status(404).json({ message: 'One or more participant IDs are invalid' });
        }

        if (participantIds.includes(userId)) {
            return res.status(400).json({ message: 'Cannot include self in participantIds' });
        }

        // Create group chat
        const groupChat = new Chat({
            participants: [userId, ...participantIds],
            chatName,
            isGroupChat: true,
            groupAdmin: userId
        });

        await groupChat.save();

        res.status(201).json({ chatId: groupChat._id });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message});
    }
}

exports.getChatMessages = async (req, res) => {
    try {
        const { chatId } = req.params;
        const userId = req.user.userId;
        
        //Verify user is part of the chat
        const chat = await Chat.findById(chatId);
        if (!chat || !chat.participants.includes(userId)) {
            return res.status(403).json({ message: 'Access Denied' });
        }

        //Fetch messages
        const messages = await Message.find({ chat: chatId })
            .populate('sender', 'username')
            .sort({ createdAt: 1 })
            .lean();
        res.status(200).json(messages);
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message});
    }
}

exports.getUserChats = async (req, res) => {
    try {
        const userId = req.user.userId;

        //Fetch chats for the user
        const chats = await Chat.find({ participants: userId})
            .populate('participants', 'username')
            .populate('latestMessage')
            .lean();

        const formattedChats = chats.map(chat => ({
            chatId: chat._id,
            participants: chat.participants,
            chatName: chat.chatName,
            isGroupChat: chat.isGroupChat,
            latestMessage: chat.latestMessage ? {
                _id: chat.latestMessage._id,
                chat: chat.latestMessage.chat,
                sender: chat.latestMessage.sender,
                content: chat.latestMessage.content,
                createdAt: chat.latestMessage.createdAt,
            } : null,
            groupAdmin: chat.groupAdmin,
            createdAt: chat.createdAt,
        }));

        res.status(200).json(formattedChats);
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
}

// DELETE CHAT
exports.deleteChat = async (req, res) => {
    try {
        const { chatId } = req.params;
        const userId = req.user.userId;

        // Verify user is part of the chat
        const chat = await Chat.findById(chatId);
        if (!chat || !chat.participants.includes(userId)) {
            return res.status(403).json({ message: 'Access Denied' });
        }

        await Chat.deleteOne({ _id: chatId });
        await Message.deleteMany({ chat: chatId });

        res.status(200).json({ message: 'Chat deleted successfully' });
        
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message }); 
    }
}

// GET CHAT DETAILS

exports.getChatDetails = async (req, res) => {
    try {
        const { chatId } = req.params;
        const userId = req.user.userId;

        // Verify user is part of the chat
        const chat = await Chat.findById(chatId).populate('participants', 'username').lean();
        
        if (!chat || !chat.participants.some(participant => participant._id.toString() === userId)) {
            return res.status(403).json({ message: 'Access Denied' });
        }

        res.status(200).json({
            chatId: chat._id,
            participants: chat.participants,
            chatName: chat.chatName,
            isGroupChat: chat.isGroupChat,
            latestMessage: chat.latestMessage,
            groupAdmin: chat.groupAdmin,
            createdAt: chat.createdAt,
        })        
    }
    catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
}