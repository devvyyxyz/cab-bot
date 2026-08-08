module.exports = {
  ping: require('./ping'),
  info: require('./info'),
  inventory: require('./inventory').handleInventory,
  tierlist: require('./inventory').handleTierlist,
  trade: require('./trade'),
  start: require('./game').handleStart,
  top: require('./game').handleTop,
  daily: require('./game').handleDaily,
  guess: require('./game').handleGuess,
  help: require('./help'),
  settings: require('./settings'),
  forcespawn: require('./spawn'),
};
