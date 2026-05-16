import Message from "../models/Message.js";
import User from "../models/User.js";

// Get chat history for an investor
export const getChatHistory = async (req, res) => {
  try {
    let investorId;
    if (req.user.role === "admin") {
      investorId = req.params.investorId;
    } else {
      investorId = req.user._id;
    }

    if (!investorId) {
      return res.status(400).json({ message: "Investor ID is required" });
    }

    const searchId = String(investorId);

    const messages = await Message.find({ investorId: searchId }).sort({ createdAt: 1 });
    res.status(200).json(messages);
  } catch (error) {
    res.status(500).json({ message: "Server Error", error: error.message });
  }
};

// Get list of investors who have chats (for admin)
export const getChatInvestors = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ message: "Access denied" });
    }

    const messages = await Message.find().sort({ createdAt: -1 });
    
    // Get unique investor IDs
    const investorIds = [...new Set(messages.map(m => m.investorId.toString()))];
    
    // Filter out invalid ObjectIds (e.g. from mock logins) to prevent Mongoose CastError
    const validInvestorIds = investorIds.filter(id => /^[0-9a-fA-F]{24}$/.test(id));

    let investors = [];
    if (validInvestorIds.length > 0) {
      investors = await User.find({ _id: { $in: validInvestorIds } }, "name email role");
    }
    
    // Sort investors by the latest message they sent or received
    const sortedInvestors = investors.sort((a, b) => {
      const aLatest = messages.find(m => m.investorId.toString() === a._id.toString());
      const bLatest = messages.find(m => m.investorId.toString() === b._id.toString());
      return new Date(bLatest.createdAt) - new Date(aLatest.createdAt);
    });

    res.status(200).json(sortedInvestors);
  } catch (error) {
    res.status(500).json({ message: "Server Error", error: error.message });
  }
};

// Delete chat history for an investor
export const deleteChatHistory = async (req, res) => {
  try {
    let investorId;
    if (req.user.role === "admin") {
      investorId = req.params.investorId;
    } else {
      investorId = req.user._id;
    }

    if (!investorId) {
      return res.status(400).json({ message: "Investor ID is required" });
    }

    const searchId = String(investorId);

    await Message.deleteMany({ investorId: searchId });
    res.status(200).json({ message: "Chat history deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Server Error", error: error.message });
  }
};
