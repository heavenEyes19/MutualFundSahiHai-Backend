import Notification from "../models/Notification.js";

/**
 * Creates a notification in the database and emits it via Socket.IO
 * 
 * @param {Object} params
 * @param {Object} params.req - Express request object (used to get the io instance)
 * @param {String} params.userId - User ID receiving the notification
 * @param {String} params.title - Notification title
 * @param {String} params.message - Notification message body
 * @param {String} params.type - Category: 'investment', 'wallet', 'sip', 'ai', 'security', 'market'
 * @param {Object} params.metadata - Optional extra data
 */
export const sendNotification = async ({ req, userId, title, message, type, metadata = {} }) => {
  try {
    // 1. Save to DB
    const notification = new Notification({
      user: userId,
      title,
      message,
      type,
      metadata
    });
    await notification.save();

    // 2. Emit via Socket.IO if instance is available
    if (req && req.app) {
      const io = req.app.get("io");
      if (io) {
        // Emit specifically to the user's room
        io.to(String(userId)).emit("newNotification", notification);
      }
    }

    return notification;
  } catch (error) {
    console.error("Error sending notification:", error);
    // We don't throw to prevent interrupting the main business flow
    return null;
  }
};
