const {body, query, param, validationResult} = require('express-validator');
const User = require('../models/User');
const logger = require('../config/logger');


// Get user profile
exports.getCurrentUserProfile = async (req, res) => {
    try {
        const user = await User.findById(req.user.userId).select('-password').lean(); // Exclude password
        if(!user) {
            logger.warn(`User profile not found for userId: ${req.user.userId}`);
            return res.status(404).json({message: 'User not found'});
        }
        res.status(200).json(user);
    } catch (error) {
        logger.error(`Error fetching user profile for userId: ${req.user.userId}: ${error.message}`, error);
        res.status(500).json({message: 'Server error while fetching user profile'})
    }
}

// Get another user's public profile
exports.getUserPublicProfile = [
    param('userId').isMongoId().withMessage('Invalid user ID format'),
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array({onlyFirstError: true}) });
        }
        try {
            const user = await User.findById(req.params.userId).select('username avatar onlineStatus lastSeen').lean();

            if(!user) {
                logger.warn(`Public profile not found for userId: ${req.params.userId}`);
                return res.status(404).json({message: 'User not found'});
            }

            res.status(200).json(user);
        } catch (error) {
            logger.error(`Error fetching public profile for userId: ${req.params.userId}: ${error.message}`, error);
            res.status(500).json({message: 'Server error while fetching public profile'});
        }
    }
]

// Update logged-in user's profile
exports.updateCurrentUserProfile = [
    body('username').optional().trim()
        .isLength({ min: 3, max: 20 })
        .withMessage('Username must be between 3 and 20 characters').escape(),
    body('email').optional().isEmail().withMessage('Please enter a valid email address')
        .normalizeEmail(),
    body('password').optional().isLength({ min: 6 }).withMessage('Password must be at least 6 characters long'),
    body('currentPassword').if(body('password').notEmpty())
            .notEmpty().withMessage('Current password is required to change password'),
    body('avatar').optional().trim()
        .if((value, {req}) => {
            req.body.avatar !== null && req.body.avatar !== ''
        }).isURL().withMessage('Avatar must be a valid URL if provided Use null or an empty string to remove it'),
    
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array({onlyFirstError: true}) });
        }

        const userId = req.user.userId;
        const { username, email, password, currentPassword, avatar } = req.body;

        try {
            const user = await User.findById(userId);
            if (!user) {
                logger.warn(`User not found for profile update: ${userId}`);
                return res.status(404).json({ message: 'User not found' });
            }

            let changesMade = false;

            // Handle password change first if requested
            if (password) {
                const isMatch = await user.comparePassword(currentPassword);
                if (!isMatch) {
                    return res.status(400).json({ message: 'Current password is incorrect' });
                }
                user.password = password;
                changesMade = true;
            }

            // Handle username change
            if(username && username !== user.username) {
                // Check if new username is already taken
                const existingUserByUsername = await User.findOne({ username: username, _id: { $ne: userId }})
                if(existingUserByUsername) {
                    return res.status(400).json({ message: 'Username is already taken' });
                }
                user.username = username;
                changesMade = true;
            }

            // Handle email change
            if(email && email !== user.email) {
                // Check if new email is already taken
                const existingUserByEmail = await User.findOne({ email: email, _id: { $ne: userId }})
                if(existingUserByEmail) {
                    return res.status(400).json({ message: 'Email is already in use' });
                }
                user.email = email;
                changesMade = true;
            }

            // Handle avatar change
            //Check if avatar field was actually present in the request body
            if (Object.prototype.hasOwnProperty.call(req.body, 'avatar')) {
                if(req.body.avatar !== user.avatar) {
                    user.avatar = req.body.avatar;
                    changesMade = true;
                }
            }

            if (!changesMade) {
                return res.status(200).json({ message: 'No changes made to profile', user: user.toObject({ virtuals:true, versionKey: false, transform: (doc, ret) => { delete ret.password; return ret; } }) });
            }

            const updatedUser = await user.save();

            // Prepare response without password
            const userResponse = updatedUser.toObject({
                virtuals: true,
                versionKey: false,
                });
            delete userResponse.password;

            res.status(200).json({ message: 'Profile updated successfully', user: userResponse });
        } catch (error) {
            logger.error(`Error updating profile for userId: ${userId}: ${error.message}`, error);
            if (error.code === 11000 || (error.message && error.message.includes('duplicate key'))) {
                return res.status(400).json({ message: 'A unique field (like username or email) you tried to set is already in use' });
            }
            res.status(500).json({ message: 'Server error while updating profile' });
        }
    }
]

// Search users
exports.searchUsers = [
    query('keyword').optional().trim().escape(),
    query('limit').optional().isInt({ min: 1, max: 50 }).toInt(),
    query('page').optional().isInt({ min: 1 }).toInt(),

    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array({onlyFirstError: true}) });
        }

        const currentUserId = req.user.userId;
        const keyword = req.query.keyword || '';
        const limit = req.query.limit || 10;
        const page = req.query.page || 1;
        const skip = (page - 1) * limit;

        try {
            const queryOptions = {
                _id: { $ne: currentUserId } 
            }

            if (keyword) {
                queryOptions.$or = [
                    { username: { $regex: keyword, $options: 'i' } },
                    { email: { $regex: keyword, $options: 'i' } }
                ]
            }

            const users = await User.find(queryOptions)
                .select('username avatar onlineStatus lastSeen _id')
                .sort({ username: 1 })
                .skip(skip)
                .limit(limit)
                .lean();

            const totalUsers = await User.countDocuments(queryOptions);

            res.status(200).json({
                users,
                currentPage: page,
                totalPages: Math.ceil(totalUsers / limit),
                totalResults: totalUsers
            })
        } catch (error) {
            logger.error(`Error searching users with keyword "${keyword}": ${error.message}`, error);
            res.status(500).json({ message: 'Server error while searching users' });
        }
    }
]