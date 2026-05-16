import mongoose from "mongoose";
import User from "./models/User.js";
import dotenv from "dotenv";
dotenv.config();

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  const users = await User.find({ otp: { $ne: null } });
  console.log(users.map(u => ({ email: u.email, otp: u.otp })));
  process.exit(0);
}
run();
