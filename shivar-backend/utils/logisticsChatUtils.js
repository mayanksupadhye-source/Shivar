// Mirrors the existing utils/chatUtils.js convention referenced in
// Message.js and chatSocket.js — a deterministic id from two user ids so
// the same pair always maps to the same conversation regardless of who
// initiates. Only difference here: keyed by transactionId instead of listingId.
//
// Assumption: the original buildConversationId(listingId, userIdA, userIdB)
// wasn't included in the provided files, so this reconstructs it from the
// documented convention in Message.js:
//   `${id}_${smallerUserId}_${largerUserId}`

function buildLogisticsConversationId(transactionId, userIdA, userIdB) {
  const [smaller, larger] = [String(userIdA), String(userIdB)].sort();
  return `${transactionId}_${smaller}_${larger}`;
}

module.exports = { buildLogisticsConversationId };
