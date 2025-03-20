const express = require('express')
const cors = require('cors')
const authRoutes = require('./routes/authRoutes')
const userRoutes = require('./routes/userRoutes')

const app = express();

app.use(express.json())
app.use(cors())

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);

module.exports = app;