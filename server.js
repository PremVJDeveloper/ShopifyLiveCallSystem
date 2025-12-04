// server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { v4: uuidv4 } = require("uuid");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { 
    origin: "*",
    methods: ["GET", "POST"]
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  connectTimeout: 45000
});

// Serve static files from this folder
app.use(express.static(path.join(__dirname)));
app.use(express.static(path.join(__dirname, "public")));


// Serve index.html for root
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Serve admin.html for /admin
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

// Serve call-request.html for /call-request
app.get("/call-request", (req, res) => {
  res.sendFile(path.join(__dirname, "call-request.html"));
});

// Serve video-call.html
app.get("/video-call", (req, res) => {
  res.sendFile(path.join(__dirname, "video-call.html"));
});

// Serve health check endpoint
app.get("/health", (req, res) => {
  res.json({ 
    status: "healthy", 
    timestamp: new Date().toISOString(),
    connections: Object.keys(waitingQueue).length,
    activeRooms: Object.keys(activeRooms).length
  });
});

// Data structures
let waitingQueue = {}; // { socketId: { id, userData, status, timestamp } }
let activeRooms = {}; // Track active rooms: { roomId: { users: Set, createdAt, timeout } }
let userRooms = {}; // Track user room mappings: { socketId: roomId }
let userDataMap = {}; // Store user data by socket ID
let connectionTimeouts = {}; // Timeout handlers for room connections
let pendingOffers = {}; // Store pending offers for reconnection
let pendingAnswers = {}; // Store pending answers for reconnection

// Clean up old data periodically
setInterval(() => {
  const now = Date.now();
  const timeout = 30 * 60 * 1000; // 30 minutes
  
  // Clean up old waiting queue entries
  for (const [socketId, entry] of Object.entries(waitingQueue)) {
    if (now - new Date(entry.timestamp).getTime() > timeout) {
      console.log(`Cleaning up old waiting queue entry: ${socketId}`);
      delete waitingQueue[socketId];
      io.to("admin-room").emit("remove-call", { userId: socketId });
    }
  }
  
  // Clean up old rooms
  for (const [roomId, room] of Object.entries(activeRooms)) {
    if (now - room.createdAt > timeout) {
      console.log(`Cleaning up old room: ${roomId}`);
      if (room.timeout) clearTimeout(room.timeout);
      delete activeRooms[roomId];
    }
  }
}, 5 * 60 * 1000); // Run every 5 minutes

io.on("connection", (socket) => {
  console.log("User connected:", socket.id, "from:", socket.handshake.address);
  
  // Store initial connection time
  socket.connectionTime = Date.now();
  
  // Send connection acknowledged
  socket.emit("connection-ack", { 
    socketId: socket.id,
    timestamp: new Date().toISOString()
  });

  // User requests a call -> put in queue and notify admins
  socket.on("request-call", (userData) => {
    console.log("Call request from:", socket.id, userData);
    
    // Validate user data
    if (!userData || !userData.name) {
      socket.emit("request-failed", { reason: "Invalid user data" });
      return;
    }
    
    // Check if already in queue
    if (waitingQueue[socket.id]) {
      socket.emit("queue-status", { 
        position: Object.keys(waitingQueue).length,
        message: "You are already in the queue",
        alreadyInQueue: true
      });
      return;
    }
    
    waitingQueue[socket.id] = { 
      id: socket.id, 
      userData: {
        ...userData,
        socketId: socket.id,
        ipAddress: socket.handshake.address
      },
      timestamp: new Date().toISOString(),
      status: 'waiting'
    };
    
    // Store user data for reconnection
    userDataMap[socket.id] = waitingQueue[socket.id].userData;
    
    io.to("admin-room").emit("new-call", waitingQueue[socket.id]);
    console.log("Queued user:", socket.id, userData.name);
    
    // Notify user they are in queue
    const position = Object.keys(waitingQueue).length;
    socket.emit("queue-status", { 
      position: position,
      message: position === 1 ? 
        "You are next in line for a support agent" : 
        `You are position #${position} in the queue`,
      estimatedWait: Math.max(1, position - 1) * 2 // Estimated minutes
    });
    
    // Set timeout for queue (30 minutes)
    setTimeout(() => {
      if (waitingQueue[socket.id]) {
        console.log(`Queue timeout for user ${socket.id}`);
        delete waitingQueue[socket.id];
        socket.emit("queue-timeout", { 
          message: "Your queue time has expired. Please try again." 
        });
        io.to("admin-room").emit("remove-call", { userId: socket.id });
      }
    }, 30 * 60 * 1000); // 30 minutes
  });

  // Admin joins admin-room and receives all waiting users
  socket.on("admin-join", () => {
    socket.join("admin-room");
    console.log("Admin joined:", socket.id);
    
    // Send connection info
    socket.emit("admin-connected", {
      socketId: socket.id,
      waitingCount: Object.keys(waitingQueue).length,
      timestamp: new Date().toISOString()
    });
    
    // Send all waiting users to this admin
    Object.values(waitingQueue).forEach(user => {
      socket.emit("new-call", user);
    });
    
    // Send active room count
    socket.emit("active-rooms", {
      count: Object.keys(activeRooms).length,
      rooms: Object.keys(activeRooms)
    });
  });

  // Admin requests queue info
  socket.on("get-queue", () => {
    socket.emit("queue-info", {
      count: Object.keys(waitingQueue).length,
      users: Object.values(waitingQueue),
      timestamp: new Date().toISOString()
    });
  });

  // Admin accepts -> create a unique room and notify both admin + user
  socket.on("accept-call", ({ userId }) => {
    console.log(`Admin ${socket.id} accepting call from user ${userId}`);
    
    if (!waitingQueue[userId]) {
      console.log("User not found in waiting queue:", userId);
      socket.emit("accept-failed", { 
        reason: "User no longer waiting",
        userId: userId 
      });
      return;
    }

    const roomId = uuidv4();
    console.log(`Creating room ${roomId} for user ${userId} and admin ${socket.id}`);
    
    // Remove user from waiting queue
    const userEntry = waitingQueue[userId];
    delete waitingQueue[userId];
    
    // Store user data for room
    const userData = userEntry.userData;
    
    // Create room entry
    activeRooms[roomId] = {
      users: new Set([socket.id, userId]),
      createdAt: Date.now(),
      adminId: socket.id,
      userId: userId,
      userData: userData,
      status: 'connecting'
    };
    
    // Store room mappings
    userRooms[socket.id] = roomId;
    userRooms[userId] = roomId;
    
    // Set connection timeout (90 seconds for slow permissions)
    const timeout = setTimeout(() => {
      console.log(`Connection timeout for room ${roomId}`);
      io.to(roomId).emit("connection-timeout", { 
        roomId: roomId,
        message: "Connection timeout. Please try again." 
      });
      
      // Clean up room
      cleanupRoom(roomId);
    }, 90000); // 90 seconds
    
    activeRooms[roomId].timeout = timeout;
    connectionTimeouts[roomId] = timeout;
    
    // Join both users to the room
    io.sockets.sockets.get(socket.id)?.join(roomId);
    io.sockets.sockets.get(userId)?.join(roomId);
    
    // Notify the user with the roomId (so user can join)
    io.to(userId).emit("call-accepted", { 
      roomId, 
      adminId: socket.id,
      userData: userData,
      timestamp: new Date().toISOString(),
      connectionTimeout: 90 // seconds
    });

    // Notify the admin that the call has been accepted and provide roomId
    socket.emit("call-accepted-admin", { 
      roomId, 
      userId,
      userData: userData,
      timestamp: new Date().toISOString(),
      connectionTimeout: 90 // seconds
    });

    // Also notify other admins to remove the queued user from UI
    io.to("admin-room").emit("remove-call", { userId: userId });
    
    console.log(`Room ${roomId} created. Waiting for users to join...`);
  });

  // User or admin successfully joined room
  socket.on("room-joined", ({ room, role, mediaReady = false }) => {
    console.log(`${socket.id} joined room ${room} as ${role}, mediaReady: ${mediaReady}`);
    
    // Clear connection timeout if both users have joined
    if (activeRooms[room] && connectionTimeouts[room]) {
      clearTimeout(connectionTimeouts[room]);
      delete connectionTimeouts[room];
      activeRooms[room].timeout = null;
      activeRooms[room].status = 'active';
    }
    
    // Notify other user in room
    socket.to(room).emit("peer-joined", { 
      socketId: socket.id,
      role: role,
      mediaReady: mediaReady,
      timestamp: new Date().toISOString()
    });
    
    // Send room info
    socket.emit("room-info", {
      roomId: room,
      users: Array.from(activeRooms[room]?.users || []),
      status: activeRooms[room]?.status || 'unknown'
    });
  });

  // Media ready notification
  socket.on("media-ready", ({ room, hasVideo, hasAudio }) => {
    console.log(`${socket.id} media ready in room ${room}: video=${hasVideo}, audio=${hasAudio}`);
    
    // Notify other user
    socket.to(room).emit("peer-media-ready", {
      socketId: socket.id,
      hasVideo: hasVideo,
      hasAudio: hasAudio,
      timestamp: new Date().toISOString()
    });
  });

  // Cancel call request
  socket.on("cancel-call", () => {
    console.log("User canceled call:", socket.id);
    if (waitingQueue[socket.id]) {
      delete waitingQueue[socket.id];
      io.to("admin-room").emit("remove-call", { userId: socket.id });
      socket.emit("call-canceled", { 
        message: "Call request canceled",
        timestamp: new Date().toISOString()
      });
    }
  });

  // Reconnection handling
  socket.on("reconnect-call", ({ room, userId }) => {
    console.log(`Reconnection attempt for ${userId} in room ${room}`);
    
    if (activeRooms[room] && activeRooms[room].users.has(userId)) {
      socket.join(room);
      userRooms[socket.id] = room;
      
      // Update socket ID mapping if reconnecting with new socket
      if (socket.id !== userId) {
        activeRooms[room].users.delete(userId);
        activeRooms[room].users.add(socket.id);
        userRooms[socket.id] = room;
        delete userRooms[userId];
      }
      
      socket.to(room).emit("user-reconnected", { 
        id: socket.id,
        oldId: userId,
        timestamp: new Date().toISOString()
      });
      
      socket.emit("reconnect-success", {
        roomId: room,
        users: Array.from(activeRooms[room].users),
        timestamp: new Date().toISOString()
      });
    } else {
      socket.emit("reconnect-failed", {
        reason: "Room not found or user not in room",
        roomId: room,
        userId: userId
      });
    }
  });

  // WebRTC signaling messages scoped to room
  socket.on("join-room", (room) => {
    socket.join(room);
    console.log(`${socket.id} joined room ${room}`);
    
    // Notify others in room
    socket.to(room).emit("user-joined", { 
      id: socket.id,
      timestamp: new Date().toISOString()
    });
    
    // Send any pending offers/answers
    if (pendingOffers[room] && pendingOffers[room][socket.id]) {
      socket.emit("offer", pendingOffers[room][socket.id]);
    }
    if (pendingAnswers[room] && pendingAnswers[room][socket.id]) {
      socket.emit("answer", pendingAnswers[room][socket.id]);
    }
  });

  socket.on("offer", ({ room, offer, targetId }) => {
    console.log(`Offer from ${socket.id} in room ${room}, target: ${targetId || 'broadcast'}`);
    
    // Store offer for reconnection
    if (!pendingOffers[room]) pendingOffers[room] = {};
    if (targetId) {
      pendingOffers[room][targetId] = offer;
    }
    
    if (targetId) {
      // Send to specific target
      socket.to(targetId).emit("offer", offer);
    } else {
      // Broadcast to room (excluding sender)
      socket.to(room).emit("offer", offer);
    }
  });

  socket.on("answer", ({ room, answer, targetId }) => {
    console.log(`Answer from ${socket.id} in room ${room}, target: ${targetId || 'broadcast'}`);
    
    // Store answer for reconnection
    if (!pendingAnswers[room]) pendingAnswers[room] = {};
    if (targetId) {
      pendingAnswers[room][targetId] = answer;
    }
    
    if (targetId) {
      // Send to specific target
      socket.to(targetId).emit("answer", answer);
    } else {
      // Broadcast to room (excluding sender)
      socket.to(room).emit("answer", answer);
    }
  });

  socket.on("ice", ({ room, candidate, targetId }) => {
    // console.log(`ICE candidate from ${socket.id} in room ${room}`);
    
    if (targetId) {
      // Send to specific target
      socket.to(targetId).emit("ice", candidate);
    } else {
      // Broadcast to room (excluding sender)
      socket.to(room).emit("ice", candidate);
    }
  });

  // End call
  socket.on("end-call", ({ room, reason }) => {
    console.log(`${socket.id} ending call in room ${room}, reason: ${reason}`);
    
    // Notify other user
    socket.to(room).emit("call-ended", {
      by: socket.id,
      reason: reason || "Call ended by peer",
      timestamp: new Date().toISOString()
    });
    
    // Clean up room
    cleanupRoom(room);
    
    // Notify user
    socket.emit("call-ended-confirm", {
      roomId: room,
      timestamp: new Date().toISOString()
    });
  });

  // Leave room
  socket.on("leave-room", (room) => {
    console.log(`${socket.id} leaving room ${room}`);
    socket.leave(room);
    
    // Update room tracking
    if (activeRooms[room]) {
      activeRooms[room].users.delete(socket.id);
      if (activeRooms[room].users.size === 0) {
        cleanupRoom(room);
      }
    }
    
    delete userRooms[socket.id];
  });

  // Ping/pong for connection health
  socket.on("ping", () => {
    socket.emit("pong", { 
      timestamp: new Date().toISOString(),
      serverTime: Date.now()
    });
  });

  // Get user info
  socket.on("get-user-info", ({ userId }) => {
    const info = userDataMap[userId] || waitingQueue[userId]?.userData;
    socket.emit("user-info", {
      userId: userId,
      data: info,
      found: !!info
    });
  });

  // Get room info
  socket.on("get-room-info", (room) => {
    const roomInfo = activeRooms[room];
    socket.emit("room-info-response", {
      roomId: room,
      exists: !!roomInfo,
      data: roomInfo,
      userCount: roomInfo?.users.size || 0
    });
  });

  // Disconnect handler
  socket.on("disconnect", (reason) => {
    console.log("User disconnected:", socket.id, "reason:", reason);
    
    const room = userRooms[socket.id];
    
    // Clean up room tracking
    if (room && activeRooms[room]) {
      activeRooms[room].users.delete(socket.id);
      
      // Notify other user in room about disconnection
      socket.to(room).emit("peer-disconnected", {
        socketId: socket.id,
        reason: reason,
        timestamp: new Date().toISOString(),
        reconnectPossible: reason === "transport close" || reason === "ping timeout"
      });
      
      // Clean up empty rooms after delay (allow reconnection)
      setTimeout(() => {
        if (activeRooms[room] && activeRooms[room].users.size === 0) {
          cleanupRoom(room);
        }
      }, 10000); // 10 second grace period for reconnection
    }
    
    delete userRooms[socket.id];
    
    // Remove from waiting queue if present
    if (waitingQueue[socket.id]) {
      delete waitingQueue[socket.id];
      // Inform admins to remove if it was in queue
      io.to("admin-room").emit("remove-call", { userId: socket.id });
    }
    
    // Clean up user data after delay
    setTimeout(() => {
      if (!io.sockets.sockets.get(socket.id)) {
        delete userDataMap[socket.id];
      }
    }, 30000); // 30 seconds
  });

  // Error handler
  socket.on("error", (error) => {
    console.error("Socket error for", socket.id, ":", error);
    socket.emit("socket-error", {
      error: error.message || "Unknown socket error",
      timestamp: new Date().toISOString()
    });
  });
});

// Helper function to clean up room
function cleanupRoom(roomId) {
  console.log(`Cleaning up room ${roomId}`);
  
  // Clear timeout if exists
  if (connectionTimeouts[roomId]) {
    clearTimeout(connectionTimeouts[roomId]);
    delete connectionTimeouts[roomId];
  }
  
  if (activeRooms[roomId] && activeRooms[roomId].timeout) {
    clearTimeout(activeRooms[roomId].timeout);
  }
  
  // Clean up pending offers/answers
  delete pendingOffers[roomId];
  delete pendingAnswers[roomId];
  
  // Remove from active rooms
  delete activeRooms[roomId];
  
  // Clean up user room mappings
  for (const [socketId, room] of Object.entries(userRooms)) {
    if (room === roomId) {
      delete userRooms[socketId];
    }
  }
}

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Signaling server running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`👑 Admin panel: http://localhost:${PORT}/admin`);
  console.log(`📞 Call endpoint: http://localhost:${PORT}/call-request`);
});

// Handle server shutdown gracefully
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  
  // Notify all connected clients
  io.emit('server-shutdown', {
    message: 'Server is shutting down for maintenance',
    timestamp: new Date().toISOString()
  });
  
  // Close server after short delay
  setTimeout(() => {
    server.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  }, 5000);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // Don't exit, keep server running
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});