import express from "express";
import cors from "cors";
import authRoutes from "./routes/authRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import mutualFundRoutes from "./routes/mutualFundRoutes.js";
import chatbotRoutes from "./routes/chatbotRoutes.js";
import portfolioRoutes from "./routes/portfolioRoutes.js";
import sipRoutes from "./routes/sipRoutes.js";
import kycRoutes from "./routes/kycRoutes.js";
import path from "path";

const app = express();

// middleware
app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(path.join(process.cwd(), "public", "uploads")));

import chatRoutes from "./routes/chatRoutes.js";
import paymentRoutes from "./routes/paymentRoutes.js";
import walletRoutes from "./routes/walletRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";

// routes
app.use("/api/auth", authRoutes); 
app.use("/api/users", userRoutes);
app.use("/api/mutual-funds", mutualFundRoutes);
app.use("/api/chatbot", chatbotRoutes);
app.use("/api/portfolio", portfolioRoutes);
app.use("/api/sips", sipRoutes);
app.use("/api/kyc", kycRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/payment", paymentRoutes);
app.use("/api/wallet", walletRoutes);
app.use("/api/notifications", notificationRoutes);

app.get("/", (req, res) => {
  res.send("API Running");
});

export default app;
