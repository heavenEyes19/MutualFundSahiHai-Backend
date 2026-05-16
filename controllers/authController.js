import User from "../models/User.js";
import bcrypt from "bcryptjs";
import generateToken from "../utils/generateToken.js";
import sendEmail from "../utils/sendEmail.js";
import { sendNotification } from "../utils/notificationService.js";


// 🔹 REGISTER
export const register = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Check if user exists
    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ msg: "User already exists" });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user (defaults to investor)
    const user = await User.create({
      name,
      email,
      password: hashedPassword,
    });

    // Send response WITHOUT password
    res.status(201).json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      token: generateToken(user._id, user.role), // ✅ auto login after register
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};



// 🔹 LOGIN
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(400).json({ msg: "User not found" });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(400).json({ msg: "Invalid password" });
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Hash OTP for security (optional, but let's keep it simple for now as requested, or just hash it. Let's save it directly since it's short lived)
    user.otp = otp;
    user.otpExpires = Date.now() + 10 * 60 * 1000; // 10 minutes
    await user.save();

    // Send email
    const message = `Your login OTP is ${otp}. It is valid for 10 minutes. Please do not share it with anyone.`;
    
    try {
      await sendEmail({
        email: user.email,
        subject: "Login OTP - MutualFund Sahi Hai",
        message,
      });
      res.json({ msg: "OTP sent to your email", requiresOtp: true, email: user.email });
    } catch (error) {
      user.otp = undefined;
      user.otpExpires = undefined;
      await user.save();
      return res.status(500).json({ msg: "Email could not be sent" });
    }

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// 🔹 VERIFY OTP
export const verifyOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ msg: "Please provide email and OTP" });
    }

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(400).json({ msg: "User not found" });
    }

    if (user.otp !== otp) {
      return res.status(400).json({ msg: "Invalid OTP" });
    }

    if (user.otpExpires < Date.now()) {
      return res.status(400).json({ msg: "OTP has expired" });
    }

    // Clear OTP
    user.otp = undefined;
    user.otpExpires = undefined;
    await user.save();

    // Send security notification (New Login Detected)
    await sendNotification({
      req,
      userId: user._id,
      title: "New Login Detected",
      message: `A new login was detected on your account.`,
      type: "security"
    });

    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      token: generateToken(user._id, user.role),
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};