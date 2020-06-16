const MLT = {
  SCOPE: "multilevel-tokens",
  SETTING_TINT_COLOR: "tintcolor",
  DEFAULT_TINT_COLOR: "#808080",
  TAG_SOURCE: "@source:",
  TAG_TARGET: "@target:",
  TAG_IN: "@in:",
  TAG_OUT: "@out:",
  TAG_INOUT: "@inout:",
  FLAG_SOURCE_TOKEN: "stoken",
  FLAG_SOURCE_RECT: "srect",
  FLAG_TARGET_RECT: "trect",
  REPLICATED_UPDATE: "mlt_bypass",
};

class MltRequestBatch {
  constructor() {
    this._scenes = {};
    this._extraActions = [];
  }

  createToken(scene, data) {
    this._scene(scene).create.push(data);
  }

  updateToken(scene, data) {
    this._scene(scene).update.push(data);
  }

  deleteToken(scene, id) {
    this._scene(scene).delete.push(id);
  }

  extraAction(f) {
    this._extraActions.push(f);
  }

  _scene(scene) {
    if (!(scene._id in this._scenes)) {
      this._scenes[scene._id] = {create: [], update: [], delete: []};
    }
    return this._scenes[scene._id];
  }
}

class MultilevelTokens {
  constructor() {
    game.settings.register(MLT.SCOPE, MLT.SETTING_TINT_COLOR, {
      name: "Tint color for cloned tokens",
      hint: "Extra tint color applied to cloned tokens in target regions. Should be a hex color code.",
      scope: "world",
      config: true,
      type: String,
      default: MLT.DEFAULT_TINT_COLOR,
      onChange: this.refreshAll.bind(this),
    });
    Hooks.on("ready", this._onReady.bind(this));
    Hooks.on("createDrawing", this._onCreateDrawing.bind(this));
    Hooks.on("preUpdateDrawing", this._onPreUpdateDrawing.bind(this));
    Hooks.on("updateDrawing", this._onUpdateDrawing.bind(this));
    Hooks.on("deleteDrawing", this._onDeleteDrawing.bind(this));
    Hooks.on("createToken", this._onCreateToken.bind(this));
    Hooks.on("preUpdateToken", this._onPreUpdateToken.bind(this));
    Hooks.on("updateToken", this._onUpdateToken.bind(this));
    Hooks.on("preDeleteToken", this._onPreDeleteToken.bind(this));
    Hooks.on("deleteToken", this._onDeleteToken.bind(this));
    this._lastTeleport = {};
    this._asyncQueue = null;
    this._asyncCount = 0;
    MultilevelTokens.log("Initialized");
  }

  static log(message) {
    console.log("Multilevel Tokens | " + message)
  }

  _isUserGamemaster(userId) {
    const user = game.users.get(userId);
    return user ? user.role === CONST.USER_ROLES.GAMEMASTER : false;
  }

  _getActiveGamemasters() {
    return game.users
        .filter(user => user.active && user.role === CONST.USER_ROLES.GAMEMASTER)
        .map(user => user._id)
        .sort();
  }

  _isOnlyGamemaster() {
    if (!game.user.isGM) {
      return false;
    }
    const activeGamemasters = this._getActiveGamemasters();
    return activeGamemasters.length === 1 && activeGamemasters[0] === game.user._id;
  }

  _isPrimaryGamemaster() {
    // To ensure commands are only issued once, return true only if we are the
    // _first_ active GM.
    if (!game.user.isGM) {
      return false;
    }
    const activeGamemasters = this._getActiveGamemasters();
    return activeGamemasters.length > 0 && activeGamemasters[0] === game.user._id;
  }

  _sceneOfDrawing(drawingId) {
    return game.scenes.find(s => s.data.drawings.some(e => e._id === drawingId));
  }

  _sceneOfToken(tokenId) {
    return game.scenes.find(s => s.data.tokens.some(e => e._id === tokenId));
  }

  _drawingById(drawingId) {
    const scene = this._sceneOfDrawing(drawingId);
    return scene && scene.data.drawings.find(e => e._id === drawingId);
  }

  _isTaggedRect(drawing, tags) {
    return drawing.type == CONST.DRAWING_TYPES.RECTANGLE &&
        this._isUserGamemaster(drawing.author) &&
        (tags.constructor === Array
            ? tags.some(t => drawing.text.startsWith(t))
            : drawing.text.startsWith(tags));
  }

  _getRectTag(drawing, tag) {
    return this._isTaggedRect(drawing, tag) ? drawing.text.substring(tag.length) : null;
  }

  _isReplicatedToken(token) {
    return (MLT.SCOPE in token.flags) &&
        (MLT.FLAG_SOURCE_TOKEN in token.flags[MLT.SCOPE]);
  }

  _isTokenInRect(token, scene, rect) {
    const tokenX = token.x + token.width * scene.data.grid / 2;
    const tokenY = token.y + token.height * scene.data.grid / 2;
    return tokenX >= rect.x && tokenX <= rect.x + rect.width &&
           tokenY >= rect.y && tokenY <= rect.y + rect.height;
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

  _getReplicatedTokenCreateData(token, sourceScene, sourceRect, targetScene, targetRect) {
    const targetPosition =
        this._mapTokenPosition(token, sourceScene, sourceRect, targetScene, targetRect);
    const targetScaleFactor = this._getScaleFactor(sourceScene, sourceRect, targetScene, targetRect);

    const tintRgb = token.tint ? hexToRGB(colorStringToHex(token.tint)) : [1., 1., 1.];
    const multRgb = hexToRGB(colorStringToHex(
        game.settings.get(MLT.SCOPE, MLT.SETTING_TINT_COLOR) || MLT.DEFAULT_TINT_COLOR));
    for (let i = 0; i < multRgb.length; ++i) {
      tintRgb[i] *= multRgb[i];
    }

    const data = duplicate(token);
    delete data._id;
    delete data.actorId;
    data.actorLink = false;
    data.vision = false;
    data.x = targetPosition.x;
    data.y = targetPosition.y;
    data.scale *= targetScaleFactor;
    data.tint = "#" + rgbToHex(tintRgb).toString(16);
    data.flags = {};
    data.flags[MLT.SCOPE] = {};
    data.flags[MLT.SCOPE][MLT.FLAG_SOURCE_TOKEN] = token._id;
    data.flags[MLT.SCOPE][MLT.FLAG_SOURCE_RECT] = sourceRect._id;
    data.flags[MLT.SCOPE][MLT.FLAG_TARGET_RECT] = targetRect._id;
    return data;
  }

  _getReplicatedTokenUpdateData(sourceToken, replicatedToken, sourceScene, sourceRect, targetScene, targetRect) {
    const data = this._getReplicatedTokenCreateData(sourceToken, sourceScene, sourceRect, targetScene, targetRect);
    data._id = replicatedToken._id;
    delete data.flags;
    return data;
  }

  _getLinkedRectsForRectByTag(rect, rectTag, resultTags) {
    const id = this._getRectTag(rect, rectTag);
    if (!id) {
      return [];
    }
    return game.scenes.map(scene => scene.data.drawings
        .filter(drawing => drawing._id !== rect._id && (resultTags.constructor === Array
            ? resultTags.some(t => this._getRectTag(drawing, t) === id)
            : this._getRectTag(drawing, resultTags) === id))
        .map(resultRect => [rect, scene, resultRect])
    ).flat();
  }

  _getTaggedRectsContainingToken(token, tags) {
    const sourceScene = this._sceneOfToken(token._id);
    return sourceScene.data.drawings
        .filter(drawing => this._isTaggedRect(drawing, tags) &&
                           this._isTokenInRect(token, sourceScene, drawing));
  }

  _getReplicatedTokensForSourceToken(sourceToken, f) {
    return game.scenes.map(scene => scene.data.tokens
        .filter(token => this._isReplicatedToken(token) &&
                         token.flags[MLT.SCOPE][MLT.FLAG_SOURCE_TOKEN] === sourceToken._id)
        .map(token => [scene, token])
    ).flat();
  }

  _getReplicatedTokensForRect(rect, f) {
    return game.scenes.map(scene => scene.data.tokens
        .filter(token => this._isReplicatedToken(token) &&
                         (token.flags[MLT.SCOPE][MLT.FLAG_SOURCE_RECT] === rect._id ||
                          token.flags[MLT.SCOPE][MLT.FLAG_TARGET_RECT] === rect._id))
        .map(token => [scene, token])
    ).flat();
  }

  _getTokensToReplicateForRect(sourceScene, sourceRect) {
    return sourceScene.data.tokens
        .filter(token => this._isTokenInRect(token, sourceScene, sourceRect) &&
                         !this._isReplicatedToken(token));
  }

  _replicateTokenFromRectToRect(requestBatch, token, sourceRect, targetRect) {
    const sourceScene = this._sceneOfDrawing(sourceRect._id);
    if (this._sceneOfToken(token._id) !== sourceScene ||
        this._isReplicatedToken(token) || !this._isTokenInRect(token, sourceScene, sourceRect)) {
      return;
    }

    const targetScene = this._sceneOfDrawing(targetRect._id);
    requestBatch.createToken(targetScene,
        this._getReplicatedTokenCreateData(token, sourceScene, sourceRect, targetScene, targetRect));
  }

  _updateReplicatedToken(requestBatch, sourceToken, replicatedToken, sourceRect, targetRect) {
    const sourceScene = this._sceneOfDrawing(sourceRect._id);
    const targetScene = this._sceneOfDrawing(targetRect._id);
    if (this._sceneOfToken(sourceToken._id) !== sourceScene ||
        this._sceneOfToken(replicatedToken._id) !== targetScene ||
        this._isReplicatedToken(sourceToken) || !this._isReplicatedToken(replicatedToken) ||
        !this._isTokenInRect(sourceToken, sourceScene, sourceRect)) {
      return;
    }

    requestBatch.updateToken(targetScene,
        this._getReplicatedTokenUpdateData(sourceToken, replicatedToken, sourceScene, sourceRect, targetScene, targetRect));
  }

  _replicateTokenToAllRects(requestBatch, token) {
    if (this._isReplicatedToken(token)) {
      return;
    }

    this._getTaggedRectsContainingToken(token, MLT.TAG_SOURCE)
        .flatMap(r => this._getLinkedRectsForRectByTag(r, MLT.TAG_SOURCE, MLT.TAG_TARGET))
        .forEach(([sourceRect, _, targetRect]) => this._replicateTokenFromRectToRect(requestBatch, token, sourceRect, targetRect));
  }

  _updateAllReplicatedTokens(requestBatch, token) {
    if (this._isReplicatedToken(token)) {
      return;
    }

    const mappedRects =  this._getTaggedRectsContainingToken(token, MLT.TAG_SOURCE)
        .flatMap(r => this._getLinkedRectsForRectByTag(r, MLT.TAG_SOURCE, MLT.TAG_TARGET));

    const tokensToDelete = [];
    const tokensToUpdate = [];
    this._getReplicatedTokensForSourceToken(token).forEach(([scene, replicatedToken]) => {
      const mappedRect = mappedRects
          .find(([sourceRect, _, targetRect]) => replicatedToken.flags[MLT.SCOPE][MLT.FLAG_SOURCE_RECT] === sourceRect._id &&
                                                 replicatedToken.flags[MLT.SCOPE][MLT.FLAG_TARGET_RECT] === targetRect._id);

      if (mappedRect) {
        tokensToUpdate.push([mappedRect[0], mappedRect[2], replicatedToken]);
      } else {
        tokensToDelete.push([scene, replicatedToken]);
      }
    });
    const tokensToCreate = mappedRects
        .filter(([s0, _, t0]) => !tokensToUpdate.some(([s1, t1, _]) => s0._id === s1._id && t0._id === t1._id));

    tokensToDelete.forEach(([scene, t]) => requestBatch.deleteToken(scene, t._id));
    tokensToUpdate.forEach(([sourceRect, targetRect, t]) => this._updateReplicatedToken(requestBatch, token, t, sourceRect, targetRect));
    tokensToCreate.forEach(([sourceRect, _, targetRect]) => this._replicateTokenFromRectToRect(requestBatch, token, sourceRect, targetRect));
  }

  _replicateAllFromSourceRect(requestBatch, sourceRect) {
    const sourceScene = this._sceneOfDrawing(sourceRect._id);
    const tokens = this._getTokensToReplicateForRect(sourceScene, sourceRect);
    this._getLinkedRectsForRectByTag(sourceRect, MLT.TAG_SOURCE, MLT.TAG_TARGET)
        .forEach(([_0, _1, targetRect]) =>
            tokens.forEach(token => this._replicateTokenFromRectToRect(requestBatch, token, sourceRect, targetRect)));
  }

  _replicateAllToTargetRect(requestBatch, targetRect) {
    this._getLinkedRectsForRectByTag(targetRect, MLT.TAG_TARGET, MLT.TAG_SOURCE)
      .forEach(([_, sourceScene, sourceRect]) =>
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
    let promise = Promise.resolve(null);
    for (const [sceneId, data] of Object.entries(requestBatch._scenes)) {
      const scene = game.scenes.get(sceneId);
      if (scene && data.delete.length) {
        const options = {isUndo: true};
        options[MLT.REPLICATED_UPDATE] = true;
        promise = promise.then(() => scene.deleteEmbeddedEntity(Token.embeddedName, data.delete, options));
      }
      if (scene && data.update.length) {
        const options = {isUndo: true, diff: true};
        options[MLT.REPLICATED_UPDATE] = true;
        promise = promise.then(() => scene.updateEmbeddedEntity(Token.embeddedName, data.update, options));
      }
      if (scene && data.create.length) {
        promise = promise.then(() => scene.createEmbeddedEntity(Token.embeddedName, data.create, {isUndo: true}));
      }
    }
    for (const f of requestBatch._extraActions) {
      promise = promise.then(f);
    }
    return promise;
  }

  // Executing multiple server requests concurrently seems to often result in requests being dropped or ignored.
  // To work around this, we use a batching system to minimize the number of requests we need to make, and queue
  // up requests if there's already some in progress.
  _queueAsync(f) {
    if (!this._isPrimaryGamemaster()) {
      return;
    }
    const batched = () => {
      const requestBatch = new MltRequestBatch();
      f(requestBatch);
      return this._execute(requestBatch);
    };
    const done = () => {
      if (--this._asyncCount === 0) {
        this._asyncQueue = null;
      }
    };
    if (this._asyncCount === 0) {
      const result = batched();
      ++this._asyncCount;
      this._asyncQueue = result.finally(done);
    } else {
      ++this._asyncCount;
      this._asyncQueue = this._asyncQueue.finally(batched).finally(done);
    }
  }

  refreshAll() {
    MultilevelTokens.log("Refreshing all");
    this._queueAsync(requestBatch => {
      game.scenes.forEach(scene => {
        scene.data.tokens
            .filter(this._isReplicatedToken.bind(this))
            .forEach(t => requestBatch.deleteToken(scene, t._id));
        scene.data.drawings
            .filter(r => this._isTaggedRect(r, MLT.TAG_SOURCE))
            .forEach(r => this._replicateAllFromSourceRect(requestBatch, r));
      });
    });
  }

  _setLastTeleport(token) {
    if (game.user.isGM) {
      this._lastTeleport[token._id] =
          this._getTaggedRectsContainingToken(token, [MLT.TAG_IN, MLT.TAG_INOUT]).map(r => r._id);
    }
  }

  _doTeleport(token) {
    if (!this._isPrimaryGamemaster()) {
      return;
    }

    const tokenScene = this._sceneOfToken(token._id);
    let lastTeleport = this._lastTeleport[token._id];
    let inRects = this._getTaggedRectsContainingToken(token, [MLT.TAG_IN, MLT.TAG_INOUT]);
    if (lastTeleport) {
      lastTeleport = lastTeleport.filter(id => inRects.some(r => r._id === id));
      inRects = inRects.filter(r => !lastTeleport.includes(r._id));
      if (lastTeleport.length) {
        this._lastTeleport[token._id] = lastTeleport;
      } else {
        delete this._lastTeleport[token._id];
      }
    }
    if (!inRects.length) {
      return;
    }

    const inRect = inRects[Math.floor(inRects.length * Math.random())];
    const inTag = this._isTaggedRect(inRect, MLT.TAG_IN) ? MLT.TAG_IN : MLT.TAG_INOUT;
    const outRects = this._getLinkedRectsForRectByTag(inRect, inTag, [MLT.TAG_OUT, MLT.TAG_INOUT]);
    if (!outRects.length) {
      return;
    }

    const outRect = outRects[Math.floor(outRects.length * Math.random())];
    const position = this._mapTokenPosition(token, tokenScene, inRect, outRect[1], outRect[2]);
    if (outRect[1] === tokenScene) {
      this._queueAsync(requestBatch => requestBatch.updateToken(tokenScene, {
        _id: token._id,
        x: position.x,
        y: position.y,
      }));
    } else {
      const data = duplicate(token);
      delete data._id;
      data.x = position.x;
      data.y = position.y;

      const actor = game.actors.get(token.actorId);
      const owners = actor ? game.users.filter(u => !u.isGM && actor.hasPerm(u, "OWNER")) : [];

      this._queueAsync(requestBatch => {
        requestBatch.deleteToken(tokenScene, token._id);
        requestBatch.createToken(outRect[1], data);
        owners.forEach(user => {
          requestBatch.extraAction(() => game.socket.emit("pullToScene", outRect[1]._id, user._id));
        })
      });
    }
  }

  _onReady() {
    // Replications might be out of sync if there was previously no GM and we just logged in.
    if (this._isOnlyGamemaster()) {
      this.refreshAll();
    }
  }

  _onCreateDrawing(scene, drawing, options, userId) {
    if (this._isTaggedRect(drawing, MLT.TAG_SOURCE)) {
      const d = duplicate(drawing);
      this._queueAsync(requestBatch => this._replicateAllFromSourceRect(requestBatch, d));
    } else if (this._isTaggedRect(drawing, MLT.TAG_TARGET)) {
      const d = duplicate(drawing);
      this._queueAsync(requestBatch => this._replicateAllToTargetRect(requestBatch, d));
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
    if (this._isTaggedRect(drawing, [MLT.TAG_SOURCE, MLT.TAG_TARGET])) {
      const d = duplicate(drawing);
      this._queueAsync(requestBatch => this._removeReplicationsForRect(requestBatch, d));
    }
  }

  _onCreateToken(scene, token, options, userId) {
    if (!this._isReplicatedToken(token)) {
      const t = duplicate(token);
      this._queueAsync(requestBatch => this._replicateTokenToAllRects(requestBatch, t));
      this._setLastTeleport(t);
    }
  }

  _onPreUpdateToken(scene, token, update, options, userId) {
    return this._onPreDeleteToken(scene, token, options, userId);
  }

  _onUpdateToken(scene, token, update, options, userId) {
    if (!this._isReplicatedToken(token)) {
      const t = duplicate(token);
      this._queueAsync(requestBatch => this._updateAllReplicatedTokens(requestBatch, t));
      if (MLT.REPLICATED_UPDATE in options) {
        this._setLastTeleport(t);
      } else {
        this._doTeleport(t);
      }
    }
  }

  _onPreDeleteToken(scene, token, options, userId) {
    if (!this._isReplicatedToken(token) || (MLT.REPLICATED_UPDATE in options)) {
      return true;
    }
    // Also allow delete in case it's a replication that got out of sync somehow.
    return !this._drawingById(token.flags[MLT.SCOPE][MLT.FLAG_SOURCE_RECT]) ||
           !this._drawingById(token.flags[MLT.SCOPE][MLT.FLAG_TARGET_RECT]);
  }

  _onDeleteToken(scene, token, options, userId) {
    if (!this._isReplicatedToken(token)) {
      const t = duplicate(token);
      this._queueAsync(requestBatch => this._removeReplicationsForSourceToken(requestBatch, t));
      delete this._lastTeleport[token._id];
    }
  }
}

MultilevelTokens.log("Loaded");
Hooks.on('init', () => game.multilevel = new MultilevelTokens());
