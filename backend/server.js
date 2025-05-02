const http = require('http');
const app = require('./app');
const connectDB = require('./config/db');
const initializeSocket = require('./config/socket');
const logger = require('./config/logger');
require('dotenv').config();

const PORT = process.env.PORT || 5000;
const server = http.createServer(app);

// Connect to MongoDB
connectDB();

// Initialize Socket.IO
initializeSocket(server);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', uptime: process.uptime() });
});

// Start server
server.listen(PORT, () => {
  logger.info(`Server is running on PORT:${PORT}`);
});

// Graceful shutdown
const shutdown = async () => {
  logger.info('Shutting down server...');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);