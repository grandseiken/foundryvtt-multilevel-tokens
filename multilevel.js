class MultilevelTokens {
  constructor() {
    Hooks.on("updateToken", this._onUpdateToken.bind(this));
    console.log("Multilevel Tokens | Initialized");
  }

  _onUpdateToken(scene, embedded, update, options, userId) {
    console.log(userId);
    console.log(update);
  }
}

console.log("Multilevel Tokens | Loaded");
Hooks.on('init', () => game.multilevelTokens = new MultilevelTokens())