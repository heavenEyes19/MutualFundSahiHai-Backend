// ⚠️ dotenv MUST be configured before any other imports so env vars are available to all modules
import dotenv from "dotenv";
dotenv.config();

import app from "./app.js";
import connectDB from "./config/db.js";
import http from "http";
import { Server } from "socket.io";
import Message from "./models/Message.js";

connectDB();

const PORT = process.env.PORT || 5000;

const server = http.createServer(app);

// Mirror the same allowed origins as Express CORS (defined in app.js)
const allowedSocketOrigins = [
  "http://localhost:5173",
  "http://localhost:3000",
  "http://127.0.0.1:5173",
  process.env.FRONTEND_URL, // e.g. https://your-app.vercel.app
].filter(Boolean);

const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      // Allow requests with no origin (Postman, curl, mobile apps)
      if (!origin) return callback(null, true);
      if (allowedSocketOrigins.includes(origin)) return callback(null, true);
      return callback(new Error(`Socket.IO CORS blocked: ${origin}`));
    },
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// Attach io to the Express app for global access in controllers
app.set("io", io);

// Health check — Render uses this to confirm the service is alive
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Simple smoke-test route
app.get("/test", (req, res) => {
  res.send("Server working ✅");
});

io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);

  socket.on("joinChat", (investorId) => {
    console.log("Socket", socket.id, "joined chat:", investorId);
    socket.join(String(investorId));
  });

  socket.on("joinAdmin", () => {
    console.log("Socket", socket.id, "joined admin room");
    socket.join("admin");
  });

  socket.on("leaveChat", (investorId) => {
    socket.leave(String(investorId));
  });

  socket.on("sendMessage", async (data) => {
    console.log("Socket", socket.id, "sending message:", data);
    try {
      const { investorId, senderId, senderRole, text } = data;
      const newMessage = new Message({ investorId, senderId, senderRole, text });

      // Save to DB first so subsequent queries see it
      await newMessage.save();

      // Emit to investor room AND admin room
      socket.to(String(investorId)).to("admin").emit("receiveMessage", newMessage);
      console.log("Message emitted successfully to", investorId, "and admin");
    } catch (err) {
      console.error("Error saving message:", err);
    }
  });

  socket.on("clearChat", (investorId) => {
    socket.to(String(investorId)).to("admin").emit("chatCleared", investorId);
  });

  socket.on("disconnect", () => {
    console.log("Socket disconnected:", socket.id);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});