function log(message) {
  console.log("Multilevel Tokens | " + message)
}

class MultilevelTokens {
  constructor() {
    Hooks.on("ready", this._onReady.bind(this));
    Hooks.on("createDrawing", this._onCreateDrawing.bind(this));
    Hooks.on("updateDrawing", this._onUpdateDrawing.bind(this));
    Hooks.on("deleteDrawing", this._onDeleteDrawing.bind(this));
    Hooks.on("createToken", this._onCreateToken.bind(this));
    Hooks.on("preUpdateToken", this._onPreUpdateToken.bind(this));
    Hooks.on("updateToken", this._onUpdateToken.bind(this));
    Hooks.on("deleteToken", this._onDeleteToken.bind(this));
    log("Initialized");
  }

  _onReady() {
    console.log("onCreateDrawing");
  }

  _onCreateDrawing(scene, entity, options, userId) {
    console.log("onCreateDrawing");
    console.log(scene);
    console.log(entity);
    console.log(options);
    console.log(userId);
  }

  _onUpdateDrawing(scene, entity, update, options, userId) {
    console.log("onUpdateDrawing");
    console.log(scene);
    console.log(entity);
    console.log(update);
    console.log(options);
    console.log(userId);
  }

  _onDeleteDrawing(scene, entity, options, userId) {
    console.log("onDeleteDrawing");
    console.log(scene);
    console.log(entity);
    console.log(options);
    console.log(userId);
  }

  _onCreateToken(scene, entity, options, userId) {
    console.log("onCreateToken");
    console.log(scene);
    console.log(entity);
    console.log(options);
    console.log(userId);
  }

  _onPreUpdateToken(scene, entity, update, options, userId) {
    console.log("onPreUpdateToken");
    console.log(scene);
    console.log(entity);
    console.log(update);
    console.log(options);
    console.log(userId);
  }

  _onUpdateToken(scene, entity, update, options, userId) {
    console.log("onUpdateToken");
    console.log(scene);
    console.log(entity);
    console.log(update);
    console.log(options);
    console.log(userId);
  }

  _onDeleteToken(scene, entity, options, userId) {
    console.log("onDeleteToken");
    console.log(scene);
    console.log(entity);
    console.log(options);
    console.log(userId);
  }
}

log("Loaded");
Hooks.on('init', () => game.multilevelTokens = new MultilevelTokens())