module.exports = {
  ping: require('./ping'),
  info: require('./info'),
  inventory: require('./inventory_local'),
  tierlist: require('./inventory').handleTierlist,
  trade: require('./trade'),
  top: require('./game').handleTop,
  daily: require('./game').handleDaily,
  guess: require('./game').handleGuess,
  help: require('./help'),
  settings: require('./settings'),
  admin: require('./admin'),
  game: require('./game').handleGame,
};
