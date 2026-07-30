const express = require('express');
const path = require('path');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const chatRoutes = require('./routes/chatRoutes');
const logger = require('./config/logger');
const { clientOrigin } = require('./config/clientOrigin');
const { isInlineFile, UPLOADS_DIR } = require('./utils/uploads');

const app = express();

// Every managed host (Render, Fly, Railway) terminates TLS at a proxy and
// forwards the real client IP in X-Forwarded-For. Without this, req.ip is the
// proxy's address for EVERY request, so the rate limiters below bucket the
// whole internet together: five login attempts per minute across all visitors,
// not per visitor. express-rate-limit v8 also emits a validation error the
// moment it sees X-Forwarded-For with trust proxy off.
//
// 1 = trust exactly one hop. Deliberately not `true` - that trusts the entire
// chain, letting a client forge X-Forwarded-For and get its own private
// rate-limit bucket, which is worse than no limiting at all.
app.set('trust proxy', 1);

app.use(helmet());
app.use(express.json());
// Single allowed browser origin, resolved in config/clientOrigin.js - which also
// warns when a production boot falls back to the dev default. Sharing the
// resolver with the Socket.IO handshake keeps the two from ever disagreeing.
app.use(cors({
  origin: clientOrigin,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));

if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

app.get('/health', (req, res) => {
      res.status(200).json({ status: 'OK', uptime: process.uptime() });
});

// Limit login/register to 5 requests per minute per IP
const authLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5,
  message: { message: 'Too many authentication attempts, please try again later.' }
});

// Limit all API endpoints to 100 requests per minute per IP
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute,
  max: 100,
  message: { message: 'Too many requests, please try again later.' }
})

// Apply auth rate limiter to login/register endpoints
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
// Same limit for demo session CREATION. Every call creates a user, four chats
// and a dozen messages, so it is the cheapest way to fill a free-tier database
// from the outside.
//
// app.post, not app.use: use() matches by prefix, so it also caught
// /api/auth/demo/end - throttling the endpoint whose whole job is DELETING a
// guest. That is backwards, and exploitable in the obvious direction: burn the
// five-per-minute budget and the creations are stopped but so is every
// cleanup, leaving the guests behind. /demo/end is left to the general /api
// limiter above.
app.post('/api/auth/demo', authLimiter);

// Apply general rate limiter to all API routes under /api
app.use('/api', apiLimiter);

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/chat', chatRoutes);

// Uploaded chat files. Outside /api on purpose - the rate limiter would count
// every <img> load. Two header overrides:
//  - helmet's default Cross-Origin-Resource-Policy: same-origin would stop
//    the Vite-origin client from embedding these images at all;
//  - anything not on the inline whitelist is forced to download, so an
//    uploaded HTML/SVG file cannot run scripts in this origin.
app.use('/uploads', express.static(UPLOADS_DIR, {
  setHeaders: (res, filePath) => {
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    if (!isInlineFile(filePath)) {
      res.setHeader('Content-Disposition', 'attachment');
    }
  }
}));

// Handle 404 Not Found for any unhandled routes
app.use((req, res, next) => {
  const error = new Error(`Not Found - ${req.originalUrl}`);
  error.statusCode = 404;
  next(error);
});

// Error-handling middleware
app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  logger.error(`${statusCode} - ${err.message} - ${req.originalUrl} - ${req.method} - ${req.ip}`, err.stack);
  
  // Send a more generic message to the client in production for non-operational errors
  const responseMessage = (process.env.NODE_ENV === 'production' && statusCode === 500)
    ? 'An unexpected server error occurred.'
    : err.message;

  res.status(statusCode).json({
    message: responseMessage,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

module.exports = app;