const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const { resolveUserId } = require('../utils/identity');
const { buildConversationId } = require('../utils/chatUtils');
const { buildLogisticsConversationId } = require('../utils/logisticsChatUtils');

function initUnifiedSocket(io) {
  // ── Single Authenticated Socket Handshake Middleware ──
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('No auth token provided'));
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = decoded; // { id, role, name, mobile, marketplaceId }
      next();
    } catch (err) {
      next(new Error('Invalid or expired auth token'));
    }
  });

  io.on('connection', (socket) => {
    const userId = String(socket.user.id);
    console.log(`🔌 Unified socket connected: ${socket.user.name} (${socket.user.role}) [${userId}]`);

    // Join personal rooms:
    // 1. By MongoDB ObjectId: user_<id>
    socket.join(`user_${userId}`);
    // 2. By Business ID (if present): user_<F0001>
    if (socket.user.marketplaceId) {
      socket.join(`user_${socket.user.marketplaceId.toUpperCase()}`);
    }

    // ── Helper: Resolve Conversation Entity ──
    async function resolveConversation({ conversationId, listingId, transactionId, otherUserId }) {
      // 1. If direct conversationId provided
      if (conversationId && mongoose.Types.ObjectId.isValid(conversationId)) {
        const conv = await Conversation.findById(conversationId);
        if (conv) return conv;
      }

      // 2. Resolve other user's Mongo ObjectId
      const targetUserId = await resolveUserId(otherUserId);
      if (!targetUserId || targetUserId === userId) return null;

      // 3. Resolve Transaction or Listing context
      let txDoc = null;
      let listingDoc = null;

      if (transactionId) {
        if (mongoose.Types.ObjectId.isValid(transactionId)) {
          txDoc = await Transaction.findById(transactionId);
        } else {
          txDoc = await Transaction.findOne({ transaction_id: String(transactionId).toUpperCase() });
        }
      }

      if (listingId && !txDoc) {
        if (mongoose.Types.ObjectId.isValid(listingId)) {
          listingDoc = await Listing.findById(listingId);
        } else {
          listingDoc = await Listing.findOne({ listing_id: String(listingId).toUpperCase() });
        }
      }

      // Determine conversation type
      let type = 'farmer_buyer';
      const otherUser = await User.findById(targetUserId).select('role');
      const otherRole = otherUser?.role;
      const myRole = socket.user.role;

      if (myRole === 'logistics' || otherRole === 'logistics') {
        type = (myRole === 'farmer' || otherRole === 'farmer') ? 'farmer_logistics' : 'buyer_logistics';
      }

      let query = { participants: { $all: [userId, targetUserId] } };
      if (txDoc) query.transaction = txDoc._id;
      else if (listingDoc) query.listing = listingDoc._id;

      let conv = await Conversation.findOne(query);
      if (!conv) {
        conv = await Conversation.create({
          type,
          transaction: txDoc ? txDoc._id : null,
          listing: listingDoc ? listingDoc._id : (txDoc ? txDoc.listing : null),
          participants: [userId, targetUserId],
          lastMessage: {
            text: 'Conversation opened',
            sender: userId,
            createdAt: new Date(),
          },
        });
      }

      return conv;
    }

    // ── JOIN CONVERSATION ──
    async function handleJoinConversation(payload) {
      try {
        const conv = await resolveConversation(payload);
        if (!conv) return;

        // Security Authorization: user must be an active participant
        const isParticipant = conv.participants.some((p) => String(p) === userId);
        if (!isParticipant) {
          socket.emit('message_error', { error: 'Unauthorized to join this conversation' });
          return;
        }

        const room = `conversation_${conv._id}`;
        socket.join(room);

        // Also join legacy string room if passed
        if (payload.listingId && payload.otherUserId) {
          socket.join(buildConversationId(payload.listingId, userId, payload.otherUserId));
        }
        if (payload.transactionId && payload.otherUserId) {
          socket.join(buildLogisticsConversationId(payload.transactionId, userId, payload.otherUserId));
        }
      } catch (err) {
        console.error('Socket join error:', err);
      }
    }

    socket.on('join_conversation', handleJoinConversation);
    socket.on('logistics_join_conversation', handleJoinConversation);

    // ── SEND MESSAGE ──
    async function handleSendMessage({ conversationId, listingId, transactionId, otherUserId, text }) {
      try {
        if (!text || !text.trim()) return;

        const conv = await resolveConversation({ conversationId, listingId, transactionId, otherUserId });
        if (!conv) {
          socket.emit('message_error', { error: 'Could not resolve conversation target' });
          socket.emit('logistics_message_error', { error: 'Could not resolve conversation target' });
          return;
        }

        // Security Authorization: user must be in participants
        const isParticipant = conv.participants.some((p) => String(p) === userId);
        if (!isParticipant) {
          socket.emit('message_error', { error: 'Access denied: You are not a participant in this conversation' });
          socket.emit('logistics_message_error', { error: 'Access denied: You are not a participant' });
          return;
        }

        // Identify the receiver
        const recipientId = conv.participants.find((p) => String(p) !== userId) || conv.participants[0];

        // Format legacy conversationId string
        let legacyId = '';
        if (conv.transaction) {
          legacyId = buildLogisticsConversationId(conv.transaction, userId, recipientId);
        } else if (conv.listing) {
          legacyId = buildConversationId(conv.listing, userId, recipientId);
        }

        // Save canonical Message
        const message = await Message.create({
          conversation: conv._id,
          conversationId: legacyId || String(conv._id),
          sender: userId,
          receiver: recipientId,
          text: text.trim(),
        });

        // Update conversation lastMessage summary
        conv.lastMessage = {
          text: message.text,
          sender: userId,
          createdAt: message.createdAt,
        };
        await conv.save();

        // Enrich broadcast payload
        const [senderUser, txDoc, listingDoc] = await Promise.all([
          User.findById(userId).select('name role marketplaceId'),
          conv.transaction ? Transaction.findById(conv.transaction).select('crop pickup_location delivery_location transaction_id') : null,
          conv.listing ? Listing.findById(conv.listing).select('crop listing_id') : null,
        ]);

        const outPayload = {
          _id: message._id,
          id: message._id,
          conversationId: String(conv._id),
          legacyConversationId: legacyId,
          sender: userId,
          receiver: String(recipientId),
          senderName: senderUser?.name || 'User',
          senderRole: senderUser?.role || 'user',
          text: message.text,
          createdAt: message.createdAt,
          crop: txDoc?.crop || listingDoc?.crop || '',
          transaction: conv.transaction ? String(conv.transaction) : null,
          listing: conv.listing ? String(conv.listing) : null,
        };

        // Broadcast to conversation room and personal rooms
        io.to(`conversation_${conv._id}`)
          .to(`user_${userId}`)
          .to(`user_${recipientId}`)
          .emit('new_message', outPayload);

        // Also emit with logistics_new_message prefix for logistics portal compatibility
        if (conv.type !== 'farmer_buyer') {
          io.to(`conversation_${conv._id}`)
            .to(`user_${userId}`)
            .to(`user_${recipientId}`)
            .emit('logistics_new_message', outPayload);
        }
      } catch (err) {
        console.error('Socket send_message error:', err);
        socket.emit('message_error', { error: 'Failed to send message', detail: err.message });
        socket.emit('logistics_message_error', { error: 'Failed to send message', detail: err.message });
      }
    }

    socket.on('send_message', handleSendMessage);
    socket.on('logistics_send_message', handleSendMessage);

    // ── TYPING INDICATORS ──
    socket.on('typing', async ({ otherUserId }) => {
      const recipientId = await resolveUserId(otherUserId);
      if (recipientId) {
        socket.to(`user_${recipientId}`).emit('user_typing', {
          userId,
          name: socket.user.name,
        });
      }
    });

    socket.on('logistics_typing', async ({ otherUserId }) => {
      const recipientId = await resolveUserId(otherUserId);
      if (recipientId) {
        socket.to(`user_${recipientId}`).emit('logistics_user_typing', {
          userId,
          name: socket.user.name,
        });
      }
    });

    socket.on('disconnect', () => {
      console.log(`🔌 Unified socket disconnected: ${socket.user.name}`);
    });
  });
}

module.exports = initUnifiedSocket;
