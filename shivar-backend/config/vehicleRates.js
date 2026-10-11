// Seed config for vehicle types, speeds, and diesel cost/km.
// Edit this table to update rates — nothing else in the codebase needs to change.
// (Indian commercial vehicle averages, diesel cost basis.)

module.exports = {
  mini_truck: {
    label: 'Mini Truck / Chhota Hathi',
    examples: ['Tata Ace', 'Ace Pro'],
    avgSpeedKmph: 50,
    dieselCostPerKm: 4.09,
  },
  small_pickup: {
    label: 'Small Pickup',
    examples: ['Tata Intra', 'Bolero Pickup'],
    avgSpeedKmph: 60,
    dieselCostPerKm: 7.50,
  },
  light_pickup: {
    label: 'Light Pickup / LCV',
    examples: ['Ashok Dost', 'Tata 407'],
    avgSpeedKmph: 62,
    dieselCostPerKm: 9.50,
  },
  medium_truck: {
    label: 'Medium Truck',
    examples: ['Tata 709/909', 'Eicher 10.90'],
    avgSpeedKmph: 67,
    dieselCostPerKm: 14.5,
  },
  heavy_truck: {
    label: 'Heavy Truck / Multi-axle',
    examples: ['Tata Signa 1918', '2823'],
    avgSpeedKmph: 72,
    dieselCostPerKm: 22,
  },
};
