const http = require('http');
const mongoose = require('mongoose');
const app = require('./app');
const connectDB = require('./config/db');
const initializeSocket = require('./config/socket');
const logger = require('./config/logger');
const redisClient = require('./config/redis');
require('dotenv').config();

const PORT = process.env.PORT || 5000;
const server = http.createServer(app);
let io;

// Global error handlers for critical issues
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  logger.info('Shutting down server due to unhandled rejection...');
  gracefulShutdown('unhandledRejection');
})

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  logger.info('Shutting down server due to uncaught exception...');
  gracefulShutdown('uncaughtException');
})

async function startServer() {
  try {
    await connectDB();
    logger.info('MongoDB connected successfully for server startup.');

    io = await initializeSocket(server);

    server.listen(PORT, () => {
      logger.info(`Server is running on PORT:${PORT}`);
    });
  } catch (error) {
    logger.error('Failed to connect to MongoDB or start the server', error);
    process.exit(1);
  }
}

let shuttingDown = false;

// Graceful shutdown
const gracefulShutdown = async (signal, exitCode = 0) => {
  if (shuttingDown) {
    logger.warn('Shutdown already in progress. Ignoring signal.');
    return;
  }
  shuttingDown = true;
  logger.info(`Received ${signal}. Shutting down gracefully...`);

  const forceShutdownTimeout = setTimeout(() => {
    logger.error('Graceful shutdown timed out (15s). Forcefully shutting down');
    process.exit(1);
  }, 15000);

  try {
    // 1. Close Socket.IO server (stops accepting new socket connections and closes existing ones)
    if (io) {
      await new Promise((resolve) => {
        io.close(() => {
          logger.info('Socket.IO server connections closed.');
          resolve();
        });
      });
    } else {
        logger.info('Socket.IO server was not initialized or already closed.');
    }

    // 2. Close HTTP server (stops accepting new HTTP connections)
    await new Promise((resolve) => {
        server.close(() => {
            logger.info('HTTP server closed.');
            resolve();
        });
    });

    // 3. Close MongoDB connection
    if (mongoose.connection.readyState === 1 || mongoose.connection.readyState === 2) { // 1: connected, 2: connecting
      await mongoose.connection.close();
      logger.info('MongoDB connection closed.');
    } else {
      logger.info('MongoDB connection was not active.');
    }

    // 4. Close Redis connection
    if (redisClient && (redisClient.status === 'ready' || redisClient.status === 'connecting')) {
      await new Promise((resolve, reject) => {
        redisClient.quit((err, res) => {
          if (err) {
            logger.error('Error quitting Redis client:', err);
            return reject(err); // Propagate error if needed, or just log
          }
          logger.info('Redis client quit command sent.');
          resolve(res);
        });
      });
      logger.info('Redis connection closed.');
    } else {
        logger.info('Redis client was not connected or already quit.');
    }
    
    clearTimeout(forceShutdownTimeout); // Crucial: clear the timeout if all steps complete
    logger.info('Graceful shutdown complete. Exiting.');
    process.exit(exitCode);

  } catch (err) {
    logger.error('Error during graceful shutdown sequence:', err);
    clearTimeout(forceShutdownTimeout); // Ensure timeout is cleared on error too
    process.exit(1);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

startServer();