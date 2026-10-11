const jwt = require("jsonwebtoken");
const Message = require("../models/Message");
const Listing = require("../models/Listing");
const User = require("../models/User");
const { buildConversationId } = require("../utils/chatUtils");

function initChatSocket(io) {
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("No token provided"));
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = decoded;
      next();
    } catch (err) {
      next(new Error("Invalid token"));
    }
  });

  io.on("connection", (socket) => {
    console.log(
      `🔌 Socket connected: ${socket.user.name} (${socket.user.role})`,
    );

    // Every user automatically joins a room keyed to their own ID.
    // This guarantees delivery to them regardless of whether they've
    // "opened" this specific conversation before — no more lost first messages.
    socket.join(`user_${socket.user.id}`);

    socket.on("join_conversation", ({ listingId, otherUserId }) => {
      const conversationId = buildConversationId(
        listingId,
        socket.user.id,
        otherUserId,
      );
      socket.join(conversationId);
    });

    socket.on("send_message", async ({ listingId, otherUserId, text }) => {
      try {
        if (!text || !text.trim()) return;
        const conversationId = buildConversationId(
          listingId,
          socket.user.id,
          otherUserId,
        );

        const message = await Message.create({
          conversationId,
          listing: listingId,
          sender: socket.user.id,
          receiver: otherUserId,
          text: text.trim(),
        });

        // Enrich the payload so a brand-new conversation (no prior bid, never opened
        // before) can render a proper name + crop on the receiving end immediately,
        // instead of a blank/placeholder entry.
        const [listing, senderUser] = await Promise.all([
          Listing.findById(listingId).select("crop"),
          User.findById(socket.user.id).select("name"),
        ]);

        const payload = {
          _id: message._id,
          conversationId,
          listing: listingId,
          sender: socket.user.id,
          receiver: otherUserId,
          text: message.text,
          createdAt: message.createdAt,
          senderName: senderUser?.name || "User",
          listingCrop: listing?.crop || "",
        };

        // Deliver straight to both people's personal rooms — works whether or not
        // either side has previously joined this specific conversation's room.
        io.to(`user_${socket.user.id}`)
          .to(`user_${otherUserId}`)
          .emit("new_message", payload);
      } catch (err) {
        socket.emit("message_error", {
          error: "Could not send message",
          detail: err.message,
        });
      }
    });

    socket.on("typing", ({ listingId, otherUserId }) => {
      const conversationId = buildConversationId(
        listingId,
        socket.user.id,
        otherUserId,
      );
      socket
        .to(`user_${otherUserId}`)
        .emit("user_typing", {
          userId: socket.user.id,
          name: socket.user.name,
          listingId,
        });
    });

    socket.on("disconnect", () => {
      console.log(`🔌 Socket disconnected: ${socket.user.name}`);
    });
  });
}

module.exports = initChatSocket;
