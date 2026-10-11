// Always builds the SAME conversationId regardless of who is "sender" vs "receiver",
// so both people land in the same conversation thread.
function buildConversationId(listingId, userIdA, userIdB) {
  const [a, b] = [String(userIdA), String(userIdB)].sort();
  return `${listingId}_${a}_${b}`;
}

module.exports = { buildConversationId };
