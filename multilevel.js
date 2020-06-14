class MultilevelTokens {
  constructor() {
    Hooks.on("updateToken", this._onUpdateToken.bind(this));
  }

  _onUpdateToken(scene, embedded, update, options, userId) {
    console.log(scene.toString() + ": " + update.toString());
  }
}

Hooks.on('init', () => game.multilevelTokens = new MultilevelTokens())