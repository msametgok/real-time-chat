const mongoose = require('mongoose');
require('dotenv').config();

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI, {
            maxPoolSize: 10,

            // Without this the driver waits out its 30s default before giving
            // up on an unreachable server. A send with Mongo down then sat in
            // server selection for a full 30 seconds, during which the UI was
            // indistinguishable from a healthy slow send - the failed bubble
            // and its Retry only appeared once the timeout finally fired.
            //
            // The trade: a blip that used to ride out invisibly now surfaces as
            // a failed send the user retries. For a single local mongod that is
            // the right side to err on - silence is the worse failure.
            serverSelectionTimeoutMS: 5000
        })
        console.log('MongoDB connected successfully');
    } catch (error) {
        console.error('MongoDB connection error:', error);
        process.exit(1);
    }
}

module.exports = connectDB;