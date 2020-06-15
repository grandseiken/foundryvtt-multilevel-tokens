const MLT = {
  FLAG_SCOPE: "multilevel-tokens",
  FLAG_SOURCE_TOKEN: "stoken",
  FLAG_SOURCE_RECT: "srect",
  FLAG_TARGET_RECT: "trect",
  SOURCE_TEXT_PREFIX: "@source:",
  TARGET_TEXT_PREFIX: "@target:"
};

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
    MultilevelTokens.log("Initialized");
  }

  static log(message) {
    console.log("Multilevel Tokens | " + message)
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

  _isUserGamemaster(userId) {
    const user = game.users.get(userId);
    return user ? user.role === CONST.USER_ROLES.GAMEMASTER : false;
  }

  _isGamemaster() {
    // TODO: is the _first_ gamemaster?
    return this._isUserGamemaster(game.userId);
  }

  _sceneOfDrawing(drawingId) {
    return game.scenes.find(s => s.data.drawings.find(e => e._id === drawingId));
  }

  _sceneOfToken(tokenId) {
    return game.scenes.find(s => s.data.tokens.find(e => e._id === tokenId));
  }

  _isSourceRect(drawing) {
    return this._isUserGamemaster(drawing.author) &&
        drawing.type === CONST.DRAWING_TYPES.RECTANGLE &&
        drawing.text.startsWith(MLT.SOURCE_TEXT_PREFIX);
  }

  _isTargetRect(drawing) {
    return this._isUserGamemaster(drawing.author) &&
        drawing.type === CONST.DRAWING_TYPES.RECTANGLE &&
        drawing.text.startsWith(MLT.TARGET_TEXT_PREFIX);
  }

  _getSourceRectId(drawing) {
    return drawing.text.substring(MLT.SOURCE_TEXT_PREFIX.length);
  }

  _getTargetRectId(drawing) {
    return drawing.text.substring(MLT.TARGET_TEXT_PREFIX.length);
  }

  _isReplicatedToken(token) {
    return (MLT.FLAG_SCOPE in token.flags) &&
        (MLT.FLAG_SOURCE_TOKEN in token.flags[MLT.FLAG_SCOPE]);
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

  _forEachTargetRectForSourceRect(sourceRect, f) {
    const id = this._getSourceRectId(sourceRect);
    game.scenes.forEach(scene => {
      scene.data.drawings.forEach(drawing => {
        if (this._isTargetRect(drawing) && this._getTargetRectId(drawing) === id) {
          f(drawing);
        }
      });
    });
  }

  _forEachSourceRectForTargetRect(targetRect, f) {
    const id = this._getTargetRectId(targetRect);
    game.scenes.forEach(scene => {
      scene.data.drawings.forEach(drawing => {
        if (this._isSourceRect(drawing) && this._getSourceRectId(drawing) === id) {
          f(drawing);
        }
      });
    });
  }

  _forEachReplicatedTokenForSourceToken(sourceToken, f) {
    game.scenes.forEach(scene => {
      scene.data.tokens.forEach(token => {
        if (this._isReplicatedToken(token) &&
            token.flags[MLT.FLAG_SCOPE][MLT.FLAG_SOURCE_TOKEN] === sourceToken._id) {
          f(scene, token);
        }
      });
    });
  }

  _forEachReplicatedTokenForSourceRect(sourceRect, f) {
    game.scenes.forEach(scene => {
      scene.data.tokens.forEach(token => {
        if (this._isReplicatedToken(token) &&
            token.flags[MLT.FLAG_SCOPE][MLT.FLAG_SOURCE_RECT] === sourceRect._id) {
          f(scene, token);
        }
      });
    });
  }

  _forEachReplicatedTokenForTargetRect(targetRect, f) {
    const targetScene = this._sceneOfDrawing(targetRect);
    targetScene.data.tokens.forEach(token => {
      if (this._isReplicatedToken(token) &&
          token.flags[MLT.FLAG_SCOPE][MLT.FLAG_TARGET_RECT] === targetRect._id) {
        f(targetScene, token);
      }
    });
  }

  _deleteToken(scene, token) {
    new Token({_id: token._id}, scene).delete();
  }

  _replicateTokenFromRectToRect(token, sourceRect, targetRect) {
    if (!this._isGamemaster()) {
      return;
    }

    const sourceScene = this._sceneOfDrawing(sourceRect._id);
    if (this._sceneOfToken(token._id) !== sourceScene ||
        this._isReplicatedToken(token) || !this._isTokenInRect(token, sourceScene, sourceRect)) {
      return;
    }

    const targetScene = this._sceneOfDrawing(targetRect._id);
    const targetPosition =
        this._mapTokenPosition(token, sourceScene, sourceRect, targetScene, targetRect);

    var data = duplicate(token);
    delete data._id;
    delete data.actorId;
    data.actorLink = false;
    data.vision = false;
    data.x = targetPosition.x;
    data.y = targetPosition.y;
    // TODO: scale?
    data.flags = {};
    data.flags[MLT.FLAG_SCOPE] = {};
    data.flags[MLT.FLAG_SCOPE][MLT.FLAG_SOURCE_TOKEN] = token._id;
    data.flags[MLT.FLAG_SCOPE][MLT.FLAG_SOURCE_RECT] = sourceRect._id;
    data.flags[MLT.FLAG_SCOPE][MLT.FLAG_TARGET_RECT] = targetRect._id;

    targetScene.createEmbeddedEntity(Token.embeddedName, data);
  }

  _replicateTokenToAllRects(token) {
    if (!this._isGamemaster()) {
      return;
    }

    const sourceScene = this._sceneOfToken(token._id);
    sourceScene.data.drawings.forEach(sourceRect => {
      if (this._isSourceRect(sourceRect) &&
          this._isTokenInRect(token, sourceScene, sourceRect)) {
        this._forEachTargetRectForSourceRect(sourceRect, targetRect => {
          this._replicateTokenFromRectToRect(token, sourceRect, targetRect);
        });
      }
    });
  }

  _replicateAllFromRectToRect(sourceRect, targetRect) {
    if (!this._isGamemaster()) {
      return;
    }

    const sourceScene = this._sceneOfDrawing(sourceRect._id);
    sourceScene.data.tokens.forEach(token => {
      if (this._isTokenInRect(token, sourceScene, sourceRect)) {
        this._replicateTokenFromRectToRect(token, sourceRect, targetRect);
      }
    });
  }

  _removeReplicationsForSourceToken(token) {
    if (!this._isGamemaster()) {
      return;
    }
    this._forEachReplicatedTokenForSourceToken(token, this._deleteToken);
  }

  _removeReplicationsForSourceRect(sourceRect) {
    if (!this._isGamemaster()) {
      return;
    }
    this._forEachReplicatedTokenForSourceRect(sourceRect, this._deleteToken);
  }

  _removeReplicationsForTargetRect(targetRect) {
    if (!this._isGamemaster()) {
      return;
    }
    this._forEachReplicatedTokenForTargetRect(targetRect, this._deleteToken);
  }
}

MultilevelTokens.log("Loaded");
Hooks.on('init', () => game.multilevel = new MultilevelTokens())