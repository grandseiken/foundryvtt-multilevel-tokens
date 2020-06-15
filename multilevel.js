const FLAG_SCOPE = "multilevel-tokens";
const FLAG_SOURCE_TOKEN = "stoken";
const FLAG_SOURCE_RECT = "srect";
const FLAG_TARGET_RECT = "trect";
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

    this.regions = {};
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
    // TODO: prevent moving (etc) replicated tokens.
    console.log("onPreUpdateToken");
    console.log(scene);
    console.log(entity);
    console.log(update);
    console.log(options);
    console.log(userId);
  }

  _onUpdateToken(scene, entity, update, options, userId) {
    // TODO: ignore replicated tokens.
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

  _isGamemaster() {
    // TODO: is the _first_ gamemaster?
    return game.user.role === CONST.USER_ROLES.GAMEMASTER;
  }

  _sceneOfDrawing(drawingId) {
    return game.scenes.find(s => s.data.drawings.find(e => e._id === drawingId));
  }

  _sceneOfToken(tokenId) {
    // TODO: so far unused.
    return game.scenes.find(s => s.data.tokens.find(e => e._id === tokenId));
  }

  _isTokenInRect(token, sourceScene, sourceRect) {
    const tokenX = token.x + token.width * sourceScene.data.grid / 2;
    const tokenY = token.y + token.height * sourceScene.data.grid / 2;
    return tokenX >= sourceRect.x && tokenX < sourceRect.x + sourceRect.width &&
           tokenY >= sourceRect.y && tokenY < sourceRect.y + sourceRect.height;
  }

  _mapTokenPosition(token, sourceScene, sourceRect, targetScene, targetRect) {
    const tokenX = token.x + token.width * sourceScene.data.grid / 2;
    const tokenY = token.y + token.height * sourceScene.data.grid / 2;
    const targetX = targetRect.x +
        (tokenX - sourceRect.x) * (targetRect.width / sourceRect.width);
    const targetY = targetRect.y +
        (tokenY - sourceRect.y) * (targetRect.height / sourceRect.height);
    return {
      x: targetX - token.width * targetScene.data.grid / 2,
      y: targetY - token.height * targetScene.data.grid / 2
    };
  }

  _replicate(token, sourceRect, targetRect) {
    if (!this._isGamemaster()) {
      return;
    }

    const sourceScene = this._sceneOfDrawing(sourceRect._id);
    if (this._sceneOfToken(token._id) !== sourceScene ||
        !this._isTokenInRect(token, sourceScene, sourceRect)) {
      return;
    }

    const targetScene = this._sceneOfDrawing(targetRect._id);
    const targetPosition =
        this._mapTokenPosition(token, sourceScene, sourceRect, targetScene, targetRect);

    var data = duplicate(token);
    delete data.actorId;
    data.actorLink = false;
    data.vision = false;
    data.x = targetPosition.x;
    data.y = targetPosition.y;
    data.flags = {};
    data.flags[FLAG_SCOPE] = {
      FLAG_SOURCE_TOKEN: token._id,
      FLAG_SOURCE_RECT: sourceRect._id,
      FLAG_TARGET_RECT: targetRect._id
    };

    Token.create(data, targetScene);
  }

  _replicateAll(sourceRect, targetRect) {
    if (!this._isGamemaster()) {
      return;
    }

    const sourceScene = this._sceneOfDrawing(sourceRect._id);
    sourceScene.data.tokens.forEach(token => {
      if (this._isTokenInRect(token, sourceScene, sourceRect)) {
        this._replicate(token, sourceRect, targetRect);
      }
    });
  }

  _removeReplications(targetRect) {
    if (!this._isGamemaster()) {
      return;
    }
  }
}

log("Loaded");
Hooks.on('init', () => game.multilevel = new MultilevelTokens())