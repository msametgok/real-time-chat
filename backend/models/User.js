// models/User.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
    username: {
        type: String,
        required: [true, 'Username is required.'], // Still good to have a message
        unique: true,
        trim: true
        // minlength and maxlength can be primarily handled by express-validator
    },
    email: {
        type: String,
        required: [true, 'Email is required.'],
        unique: true,
        trim: true,
        lowercase: true
        // Email format (match) can be primarily handled by express-validator
    },
    password: {
        type: String,
        required: [true, 'Password is required.']
        // Password minlength can be primarily handled by express-validator
    },
    avatar: {
        type: String,
        default: null
    },
    /**
     * Marks the demo companions and the throwaway guest accounts the public
     * demo hands out. Exists so cleanup has something to filter on - guests
     * accumulate on every visit and Atlas M0 is 512 MB.
     *
     * Never set through any user-facing route: only demo/seed.js writes it.
     */
    isDemo: {
        type: Boolean,
        default: false,
        index: true
    }
}, {
    timestamps: true
});

userSchema.pre('save', async function(next) {
    if (!this.isModified('password')) {
        return next();
    }
    try {
        const salt = await bcrypt.genSalt(10);
        this.password = await bcrypt.hash(this.password, salt);
        next();
    } catch (error) {
        next(error);
    }
});

// INSTANCE METHOD: Compare Password
userSchema.methods.comparePassword = async function(candidatePassword) {
    try {
        return await bcrypt.compare(candidatePassword, this.password);
    } catch (error) {
        throw error;
    }
};

module.exports = mongoose.model('User', userSchema);