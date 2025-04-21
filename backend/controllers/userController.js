const bcrypt = require('bcryptjs');
const User = require('../models/User');


// Get user profile
exports.getUserProfile = async (req, res) => {
    try {
        const user = await User.findById(req.user.userId).select('-password') // Exclude password
        if(!user) return res.status(404).json({message: 'User not found'});
        res.json(user);
    } catch (error) {
        res.status(500).json({message: 'Server error'})
    }
}

// Update user profile
exports.updateUserProfile = async (req, res) => {
    try {
        const user = await User.findById(req.user.userId);
        if(!user) return res.status(404).json({message: 'User not found' });

        const {username, email, password} = req.body;

        if(username) user.username = username;
        if(email) user.email = email;
        if(password) {
            user.password = await bcrypt.hash(password,10);
        }

        await user.save();
        res.json({message: 'Profile updated successfully'})
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
}

// Search users
exports.searchUsers = async (req, res) => {

    const keyword = req.query.keyword ? { 
        username: { $regex: req.query.keyword, $options: 'i' } 
    } : {};

    try {
        const users = await User.find({ ...keyword, _id: { $ne: req.user.userId} })
            .select('_id username')
            .lean();

        res.json(users);
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
}