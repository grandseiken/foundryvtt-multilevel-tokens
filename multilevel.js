const MLT = {
  FLAG_SCOPE: "multilevel-tokens",
  FLAG_SOURCE_TOKEN: "stoken",
  FLAG_SOURCE_RECT: "srect",
  FLAG_TARGET_RECT: "trect",
  SOURCE_TEXT_PREFIX: "@source:",
  TARGET_TEXT_PREFIX: "@target:"
};

class MltRequestBatch {
  constructor() {
    this._scenes = {}
  }

  createToken(scene, data) {
    this._scene(scene).create.push(data);
  }

  deleteToken(scene, id) {
    this._scene(scene).delete.push(id);
  }

  _scene(scene) {
    if (!(scene._id in this._scenes)) {
      this._scenes[scene._id] = {create: [], delete: []};
    }
    return this._scenes[scene._id];
  }
}

class MultilevelTokens {
  constructor() {
    Hooks.on("ready", this._onReady.bind(this));
    Hooks.on("createDrawing", this._onCreateDrawing.bind(this));
    Hooks.on("preUpdateDrawing", this._onPreUpdateDrawing.bind(this));
    Hooks.on("updateDrawing", this._onUpdateDrawing.bind(this));
    Hooks.on("deleteDrawing", this._onDeleteDrawing.bind(this));
    Hooks.on("createToken", this._onCreateToken.bind(this));
    Hooks.on("preUpdateToken", this._onPreUpdateToken.bind(this));
    Hooks.on("updateToken", this._onUpdateToken.bind(this));
    Hooks.on("deleteToken", this._onDeleteToken.bind(this));
    this._asyncQueue = null;
    this._asyncCount = 0;
    MultilevelTokens.log("Initialized");
  }

  static log(message) {
    console.log("Multilevel Tokens | " + message)
  }

  _onReady() {}

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

  _getScaleFactor(sourceScene, sourceRect, targetScene, targetRect) {
    return Math.min((targetRect.width / targetScene.data.grid) / (sourceRect.width / sourceScene.data.grid),
                    (targetRect.height / targetScene.data.grid) / (sourceRect.height/ sourceScene.data.grid));
  }

  _getReplicatedTokenData(token, sourceScene, sourceRect, targetScene, targetRect) {
    const targetPosition =
        this._mapTokenPosition(token, sourceScene, sourceRect, targetScene, targetRect);
    const targetScaleFactor = this._getScaleFactor(sourceScene, sourceRect, targetScene, targetRect);

    var data = duplicate(token);
    delete data._id;
    delete data.actorId;
    data.actorLink = false;
    data.vision = false;
    data.x = targetPosition.x;
    data.y = targetPosition.y;
    data.scale *= targetScaleFactor;
    data.flags = {};
    data.flags[MLT.FLAG_SCOPE] = {};
    data.flags[MLT.FLAG_SCOPE][MLT.FLAG_SOURCE_TOKEN] = token._id;
    data.flags[MLT.FLAG_SCOPE][MLT.FLAG_SOURCE_RECT] = sourceRect._id;
    data.flags[MLT.FLAG_SCOPE][MLT.FLAG_TARGET_RECT] = targetRect._id;
    return data;
  }

  _getTargetRectsForSourceRect(sourceRect) {
    const id = this._getSourceRectId(sourceRect);
    return game.scenes.map(scene => scene.data.drawings
        .filter(drawing => this._isTargetRect(drawing) && this._getTargetRectId(drawing) === id)
        .map(targetRect => [sourceRect, targetRect])
    ).flat();
  }

  _getSourceRectsForTargetRect(targetRect) {
    const id = this._getTargetRectId(targetRect);
    return game.scenes.map(scene => scene.data.drawings
        .filter(drawing => this._isSourceRect(drawing) && this._getSourceRectId(drawing) === id)
        .map(drawing => [scene, drawing])
    ).flat();
  }

  _getTokensToReplicateForRect(sourceScene, sourceRect) {
    return sourceScene.data.tokens
        .filter(token => this._isTokenInRect(token, sourceScene, sourceRect) &&
                         !this._isReplicatedToken(token));
  }

  _getReplicatedTokensForSourceToken(sourceToken, f) {
    return game.scenes.map(scene => scene.data.tokens
        .filter(token => this._isReplicatedToken(token) &&
                         token.flags[MLT.FLAG_SCOPE][MLT.FLAG_SOURCE_TOKEN] === sourceToken._id)
        .map(token => [scene, token])
    ).flat();
  }

  _getReplicatedTokensForRect(rect, f) {
    return game.scenes.map(scene => scene.data.tokens
        .filter(token => this._isReplicatedToken(token) &&
                         (token.flags[MLT.FLAG_SCOPE][MLT.FLAG_SOURCE_RECT] === rect._id ||
                          token.flags[MLT.FLAG_SCOPE][MLT.FLAG_TARGET_RECT] === rect._id))
        .map(token => [scene, token])
    ).flat();
  }

  _replicateTokenFromRectToRect(requestBatch, token, sourceRect, targetRect) {
    const sourceScene = this._sceneOfDrawing(sourceRect._id);
    if (this._sceneOfToken(token._id) !== sourceScene ||
        this._isReplicatedToken(token) || !this._isTokenInRect(token, sourceScene, sourceRect)) {
      return;
    }

    const targetScene = this._sceneOfDrawing(targetRect._id);
    requestBatch.createToken(targetScene,
        this._getReplicatedTokenData(token, sourceScene, sourceRect, targetScene, targetRect));
  }

  _replicateTokenToAllRects(requestBatch, token) {
    if (this._isReplicatedToken(token)) {
      return;
    }

    const sourceScene = this._sceneOfToken(token._id);
    sourceScene.data.drawings
        .filter(drawing => this._isSourceRect(drawing) &&
                           this._isTokenInRect(token, sourceScene, drawing))
        .flatMap(this._getTargetRectsForSourceRect.bind(this))
        .forEach(([sourceRect, targetRect]) => this._replicateTokenFromRectToRect(requestBatch, token, sourceRect, targetRect));
  }

  _replicateAllFromSourceRect(requestBatch, sourceRect) {
    const sourceScene = this._sceneOfDrawing(sourceRect._id);
    const tokens = this._getTokensToReplicateForRect(sourceScene, sourceRect);
    this._getTargetRectsForSourceRect(sourceRect).forEach(([_, targetRect]) => tokens
        .forEach(token => this._replicateTokenFromRectToRect(requestBatch, token, sourceRect, targetRect)));
  }

  _replicateAllToTargetRect(requestBatch, targetRect) {
    this._getSourceRectsForTargetRect(targetRect).forEach(([sourceScene, sourceRect]) =>
      this._getTokensToReplicateForRect(sourceScene, sourceRect)
          .forEach(token => this._replicateTokenFromRectToRect(requestBatch, token, sourceRect, targetRect)));
  }

  _removeReplicationsForSourceToken(requestBatch, token) {
    this._getReplicatedTokensForSourceToken(token)
        .forEach(([scene, t]) => requestBatch.deleteToken(scene, t._id));
  }

  _removeReplicationsForRect(requestBatch, rect) {
    this._getReplicatedTokensForRect(rect)
        .forEach(([scene, t]) => requestBatch.deleteToken(scene, t._id));
  }

  _execute(requestBatch) {
    var promise = Promise.resolve(null);
    for (const [sceneId, data] of Object.entries(requestBatch._scenes)) {
      const scene = game.scenes.get(sceneId);
      if (scene && data.delete.length) {
        promise = promise.then(() => scene.deleteEmbeddedEntity(Token.embeddedName, data.delete, {isUndo: true}));
      }
      if (scene && data.create.length) {
        promise = promise.then(() => scene.createEmbeddedEntity(Token.embeddedName, data.create, {isUndo: true}));
      }
    }
    return promise;
  }

  _queueAsync(f) {
    if (!this._isGamemaster()) {
      return;
    }
    const done = () => {
      if (--this._asyncCount === 0) {
        this._asyncQueue = null;
      }
    };
    if (this._asyncCount++ === 0) {
      this._asyncQueue = f().then(done);
    } else {
      this._asyncQueue = this._asyncQueue.then(f).then(done);
    }
  }

  _onCreateDrawing(scene, drawing, options, userId) {
    if (this._isSourceRect(drawing)) {
      const d = duplicate(drawing);
      this._queueAsync(() => {
        var requestBatch = new MltRequestBatch();
        this._replicateAllFromSourceRect(requestBatch, d);
        return this._execute(requestBatch);
      });
    } else if (this._isTargetRect(drawing)) {
      const d = duplicate(drawing);
      this._queueAsync(() => {
        var requestBatch = new MltRequestBatch();
        this._replicateAllToTargetRect(requestBatch, d);
        return this._execute(requestBatch);
      });
    }
  }

  _onPreUpdateDrawing(scene, drawing, update, options, userId) {
    this._onDeleteDrawing(scene, drawing, update, options, userId);
    return true;
  }

  _onUpdateDrawing(scene, drawing, update, options, userId) {
    this._onCreateDrawing(scene, drawing, options, userId);
  }

  _onDeleteDrawing(scene, drawing, options, userId) {
    if (this._isSourceRect(drawing) || this._isTargetRect(drawing)) {
      const d = duplicate(drawing);
      this._queueAsync(() => {
        var requestBatch = new MltRequestBatch();
        this._removeReplicationsForRect(requestBatch, d);
        return this._execute(requestBatch);
      });
    }
  }

  _onCreateToken(scene, token, options, userId) {
    if (!this._isReplicatedToken(token)) {
      const t = duplicate(token);
      this._queueAsync(() => {
        var requestBatch = new MltRequestBatch();
        this._replicateTokenToAllRects(requestBatch, t);
        return this._execute(requestBatch);
      });
    }
  }

  _onPreUpdateToken(scene, token, update, options, userId) {
    return !this._isReplicatedToken(token);
  }

  _onUpdateToken(scene, token, update, options, userId) {
    if (!this._isReplicatedToken(token)) {
      const t = duplicate(token);
      this._queueAsync(() => {
        var requestBatch = new MltRequestBatch();
        this._removeReplicationsForSourceToken(requestBatch, t);
        this._replicateTokenToAllRects(requestBatch, t);
        return this._execute(requestBatch);
      });
    }
  }

  _onDeleteToken(scene, token, options, userId) {
    if (!this._isReplicatedToken(token)) {
      const t = duplicate(token);
      this._queueAsync(() => {
        var requestBatch = new MltRequestBatch();
        this._removeReplicationsForSourceToken(requestBatch, t);
        return this._execute(requestBatch);
      });
    }
  }
}

MultilevelTokens.log("Loaded");
Hooks.on('init', () => game.multilevel = new MultilevelTokens())