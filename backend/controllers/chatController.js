const Chat = require('../models/Chat');
const Message = require('../models/Message');

exports.createChat = async (req, res) => {
    try {
        let { participantIds } = req.body; // Array of user IDs to chat with
        const userId = req.user.userId; //from JWT

        //Check if chat already exists between these participants
        const participants = [userId, ...participantIds].sort();
        console.log(participants);

        let chat = await Chat.findOne({ participants });

        if(!chat){
            chat = new Chat({ participants });
            await chat.save();
        }

        res.status(201).json({chatId: chat._id});
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
            .lean();

        const formattedChats = chats.map(chat => ({
            chatId: chat._id,
            participants: chat.participants,
            createdAt: chat.createdAt,
        }));

        console.log(formattedChats);
        res.status(200).json(formattedChats);
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
}