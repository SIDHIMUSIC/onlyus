const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

// roomCode -> Map(socketId -> name)
const rooms = {};

io.on("connection", (socket) => {
  let currentRoom = null;
  let currentName = null;

  socket.on("join", ({ name, room }) => {
    name = (name || "Guest").trim().slice(0, 20);
    room = (room || "").trim().toLowerCase().slice(0, 30);
    if (!room) return socket.emit("error_msg", "Room code required");

    if (!rooms[room]) rooms[room] = new Map();
    if (rooms[room].size >= 10) {
      return socket.emit("full", { max: 10 });
    }

    currentRoom = room;
    currentName = name;
    socket.join(room);
    rooms[room].set(socket.id, name);

    io.to(room).emit("online", {
      users: [...rooms[room].values()],
      count: rooms[room].size,
      max: 10,
    });
    socket.emit("joined", { room, name });
  });

  socket.on("chat", ({ text }) => {
    if (!currentRoom || !text) return;
    text = String(text).trim().slice(0, 500);
    if (!text) return;
    io.to(currentRoom).emit("chat", {
      name: currentName,
      text,
      time: Date.now(),
    });
  });

  const leave = () => {
    if (!currentRoom || !rooms[currentRoom]) return;
    rooms[currentRoom].delete(socket.id);
    io.to(currentRoom).emit("online", {
      users: [...rooms[currentRoom].values()],
      count: rooms[currentRoom].size,
      max: 10,
    });
    if (rooms[currentRoom].size === 0) delete rooms[currentRoom];
    currentRoom = null;
  };

  socket.on("leave", leave);
  socket.on("disconnect", leave);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("OnlyUs on", PORT));
