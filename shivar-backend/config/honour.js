// All Honour Score numbers live here. Change them here only.
//
// RULE: the buyer gives 3 ratings (quality, packaging, honesty), 1 to 5 stars.
// We take the average of the three and compare it with NEUTRAL_AVERAGE (2.5):
//   average above 2.5  -> score goes UP   (3 stars or more on every rating always does)
//   average below 2.5  -> score goes DOWN (2 stars or less on every rating always does)
// Each step of 1 average star moves the score by POINTS_PER_STAR points:
//   5 stars = +20, 4 stars = +12, 3 stars = +4, 2 stars = -4, 1 star = -12
module.exports = {
  START_SCORE: 50,             // every new farmer starts here (0 to 100)
  NEUTRAL_AVERAGE: 2.5,        // average at which the score does not move
  POINTS_PER_STAR: 8,          // how many points one average star is worth
  BLACKLIST_BELOW: 40,         // score under this ...
  MIN_REVIEWS_TO_BLACKLIST: 3, // ... AND at least this many reviewed orders => blacklisted
  RECEIVABLE_STATUSES: ['confirmed', 'shipped'], // order statuses where "Order Received" is allowed

  // How many points this one review adds (positive) or removes (negative)
  scoreChange(quality, packaging, honesty) {
    const average = (quality + packaging + honesty) / 3;
    return Math.round((average - this.NEUTRAL_AVERAGE) * this.POINTS_PER_STAR);
  },
};
