module.exports = {
  ping: require('./ping'),
  info: require('./info'),
  // Standalone /inventory shows DB-caught brainrots using Components V2
  inventory: require('./inventory_local'),
  // tierlist still uses the live inventory handler
  tierlist: require('./inventory').handleTierlist,
  trade: require('./trade'),
  top: require('./game').handleTop,
  daily: require('./game').handleDaily,
  guess: require('./game').handleGuess,
  help: require('./help'),
  settings: require('./settings'),
  admin: require('./admin'),
};
