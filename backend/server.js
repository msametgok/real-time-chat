const http = require('http')
const app = require('./app')
const connectDB = require('./config/db')
require('dotenv').config();

const PORT = process.env.PORT || 5000;

// Connect to MongoDB
connectDB();

// Create an HTTP server to use WebSocket
const server = http.createServer(app);

server.listen(PORT, ()=> {
    console.log(`Server is running on PORT:${PORT}`);
})