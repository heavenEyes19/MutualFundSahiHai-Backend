import { io } from 'socket.io-client';

const investorId = "test_inv_123";

// Admin socket
const adminSocket = io("http://localhost:5000");
adminSocket.on("connect", () => {
  console.log("Admin connected:", adminSocket.id);
  adminSocket.emit("joinAdmin");
});
adminSocket.on("receiveMessage", (msg) => {
  console.log("[ADMIN RECEIVED]:", msg.text);
});

// Investor socket
const investorSocket = io("http://localhost:5000");
investorSocket.on("connect", () => {
  console.log("Investor connected:", investorSocket.id);
  investorSocket.emit("joinChat", investorId);
  
  // Investor sends message after 1 second
  setTimeout(() => {
    console.log("Investor sending message...");
    investorSocket.emit("sendMessage", {
      investorId: investorId,
      senderId: investorId,
      senderRole: "investor",
      text: "Hello from investor"
    });
  }, 1000);
});

investorSocket.on("receiveMessage", (msg) => {
  console.log("[INVESTOR RECEIVED]:", msg.text);
});

setTimeout(() => {
  console.log("Admin sending message...");
  adminSocket.emit("sendMessage", {
    investorId: investorId,
    senderId: "admin_123",
    senderRole: "admin",
    text: "Hello from admin"
  });
}, 2000);

setTimeout(() => {
  console.log("Test finished.");
  process.exit(0);
}, 3000);
