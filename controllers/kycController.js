import KYC from "../models/KYC.js";
import User from "../models/User.js";

// @desc    Submit KYC details
// @route   POST /api/kyc/submit
// @access  Private (Investor)
export const submitKYC = async (req, res) => {
  try {
    const { aadharNumber, phoneNumber, panNumber } = req.body;
    const userId = req.user._id;

    // Check if files exist
    if (!req.files || !req.files.panCardPhoto || !req.files.submissionPhoto) {
      return res.status(400).json({ message: "Both PAN card and submission photos are required." });
    }

    // Get file URLs (paths relative to the server)
    const panCardPhotoUrl = `/uploads/${req.files.panCardPhoto[0].filename}`;
    const submissionPhotoUrl = `/uploads/${req.files.submissionPhoto[0].filename}`;

    // Check if KYC already submitted
    let kyc = await KYC.findOne({ userId });
    
    if (kyc) {
      if (kyc.status === "Pending" || kyc.status === "Approved") {
        return res.status(400).json({ message: `KYC already ${kyc.status.toLowerCase()}` });
      }
      
      // If Rejected, allow resubmission (update existing)
      kyc.aadharNumber = aadharNumber;
      kyc.phoneNumber = phoneNumber;
      kyc.panNumber = panNumber;
      kyc.panCardPhotoUrl = panCardPhotoUrl;
      kyc.submissionPhotoUrl = submissionPhotoUrl;
      kyc.status = "Pending";
      
      await kyc.save();
      return res.status(200).json({ message: "KYC resubmitted successfully", kyc });
    }

    // Create new KYC
    kyc = await KYC.create({
      userId,
      aadharNumber,
      phoneNumber,
      panNumber,
      panCardPhotoUrl,
      submissionPhotoUrl,
    });

    res.status(201).json({ message: "KYC submitted successfully", kyc });
  } catch (error) {
    console.error("Submit KYC Error:", error);
    res.status(500).json({ message: "Server error during KYC submission", error: error.message });
  }
};

// @desc    Get current user KYC status
// @route   GET /api/kyc/status
// @access  Private
export const getKYCStatus = async (req, res) => {
  try {
    const kyc = await KYC.findOne({ userId: req.user._id });
    
    if (!kyc) {
      return res.status(200).json({ status: "Not Submitted", kyc: null });
    }
    
    res.status(200).json({ status: kyc.status, kyc });
  } catch (error) {
    console.error("Get KYC Status Error:", error);
    res.status(500).json({ message: "Server error fetching KYC status" });
  }
};

// @desc    Get all KYC submissions
// @route   GET /api/kyc/all
// @access  Private (Admin)
export const getAllKYC = async (req, res) => {
  try {
    const kycs = await KYC.find().populate("userId", "name email");
    res.status(200).json(kycs);
  } catch (error) {
    console.error("Get All KYC Error:", error);
    res.status(500).json({ message: "Server error fetching all KYCs" });
  }
};

// @desc    Verify (Approve/Reject) KYC
// @route   PUT /api/kyc/verify/:id
// @access  Private (Admin)
export const verifyKYC = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, rejectionReason } = req.body;

    if (!["Approved", "Rejected"].includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    const kyc = await KYC.findById(id);
    
    if (!kyc) {
      return res.status(404).json({ message: "KYC submission not found" });
    }

    kyc.status = status;
    kyc.rejectionReason = status === "Rejected" ? (rejectionReason || "No reason provided") : null;
    await kyc.save();

    res.status(200).json({ message: `KYC ${status} successfully`, kyc });
  } catch (error) {
    console.error("Verify KYC Error:", error);
    res.status(500).json({ message: "Server error verifying KYC" });
  }
};
