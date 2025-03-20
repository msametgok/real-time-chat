const socketIo = require('socket.io');

const initializeSocket = (server) => {
    const io = socketIo(server, {
        cors: {
            origin: "*", // Allow all origins (or specify your frontend URL, e.g., "http://localhost:3000")
            methods: ["GET", "POST"]
        }
    });

    io.on('connection', (socket) => {
        console.log('New Client connected:', socket.id);

        /*
        // Send a test message to the client
        socket.emit('message', 'Hello from the server!');

        // Listen for messages from the client
        socket.on('clientMessage', (msg) => {
            console.log('Client says:', msg);
        });
        */

        socket.on('disconnect', () => {
            console.log('Client disconnected:', socket.id);
        })
    })

    return io;
}

module.exports = initializeSocket;