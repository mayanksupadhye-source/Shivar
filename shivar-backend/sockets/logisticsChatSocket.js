const jwt = require("jsonwebtoken");
const LogisticsMessage = require("../models/LogisticsMessage");
const TransactionReadOnly = require("../models/TransactionReadOnly");
const User = require("../models/User");
const { buildLogisticsConversationId } = require("../utils/logisticsChatUtils");

// Mirrors chatSocket.js's exact pattern (auth middleware, personal room,
// join/send/typing/disconnect) but every event is namespaced with a
// `logistics_` prefix so there is zero collision with the existing farmer↔buyer
// chat traffic on the same io instance. Reads/writes only the new
// LogisticsMessage collection — never touches Message.js or `messages`.
//
// This chat is plain messaging only: no bidding, no offer/price fields —
// deliberately does not mirror Bid.js's pattern.
function initLogisticsChatSocket(io) {
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("No token provided"));
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = decoded; // { id, name, role: 'logistics' | 'farmer' | 'buyer' }
      next();
    } catch (err) {
      next(new Error("Invalid token"));
    }
  });

  io.on("connection", (socket) => {
    console.log(
      `🚚 Logistics socket connected: ${socket.user.name} (${socket.user.role})`,
    );

    // Same personal-room pattern as chatSocket.js: guarantees delivery
    // regardless of whether either side has "opened" this conversation before.
    socket.join(`user_${socket.user.id}`);

    socket.on("logistics_join_conversation", ({ transactionId, otherUserId }) => {
      const conversationId = buildLogisticsConversationId(
        transactionId,
        socket.user.id,
        otherUserId,
      );
      socket.join(conversationId);
    });

    socket.on("logistics_send_message", async ({ transactionId, otherUserId, otherUserRole, text }) => {
      try {
        if (!text || !text.trim()) return;
        const conversationId = buildLogisticsConversationId(
          transactionId,
          socket.user.id,
          otherUserId,
        );

        const message = await LogisticsMessage.create({
          conversationId,
          transaction: transactionId,
          sender: socket.user.id,
          senderRole: socket.user.role,
          receiver: otherUserId,
          receiverRole: otherUserRole,
          text: text.trim(),
        });

        // Enrich the payload so a brand-new conversation renders a proper
        // name + crop context on the receiving end immediately.
        const [transaction, senderName] = await Promise.all([
          TransactionReadOnly.findById(transactionId).select("crop pickup_location delivery_location"),
          resolveName(socket.user.id, socket.user.role),
        ]);

        const payload = {
          _id: message._id,
          conversationId,
          transaction: transactionId,
          sender: socket.user.id,
          senderRole: socket.user.role,
          receiver: otherUserId,
          receiverRole: otherUserRole,
          text: message.text,
          createdAt: message.createdAt,
          senderName: senderName || "User",
          crop: transaction?.crop || "",
        };

        io.to(`user_${socket.user.id}`)
          .to(`user_${otherUserId}`)
          .emit("logistics_new_message", payload);
      } catch (err) {
        socket.emit("logistics_message_error", {
          error: "Could not send message",
          detail: err.message,
        });
      }
    });

    socket.on("logistics_typing", ({ otherUserId }) => {
      socket
        .to(`user_${otherUserId}`)
        .emit("logistics_user_typing", {
          userId: socket.user.id,
          name: socket.user.name,
        });
    });

    socket.on("disconnect", () => {
      console.log(`🚚 Logistics socket disconnected: ${socket.user.name}`);
    });
  });
}

// sender/receiver is always a User now — logistics partners are just
// role:'logistics' Users, same collection as farmers and buyers.
async function resolveName(userId, role) {
  const u = await User.findById(userId).select("name");
  return u?.name;
}

module.exports = initLogisticsChatSocket;