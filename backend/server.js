const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

io.on('connection', (socket) => {
  console.log('📡 New Client Connected:', socket.id);
  socket.emit('status', { message: 'AEGIS Backend Linked' });
  
  socket.on('disconnect', () => {
    console.log('❌ Client Disconnected');
  });
});

const PORT = 5000;
server.listen(PORT, () => {
  console.log(`🚀 AEGIS Brain running on http://localhost:${PORT}`);
});