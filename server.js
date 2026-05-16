import dotenv from "dotenv";
import chatbotRoutes from "./routes/chatbotRoutes.js";

dotenv.config();

// console.log("CHECK:", process.env.MFAPI_BASE_URL);
import app from "./app.js";
import connectDB from "./config/db.js";
app.use("/api", chatbotRoutes);
connectDB();

app.get("/test", (req, res) => {
  res.send("Server working ✅");
});


import http from "http";
import { Server } from "socket.io";
import Message from "./models/Message.js";

const PORT = process.env.PORT || 5000;

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*", // allow all or specify frontend url
    methods: ["GET", "POST"]
  }
});

// Attach io to the Express app for global access in controllers
app.set("io", io);

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
      // Only log actual errors
      console.error("Error saving message", err);
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
  console.log(`Server running on port ${PORT}`);
});