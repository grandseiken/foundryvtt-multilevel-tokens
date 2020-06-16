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
  FLAG_SOURCE_REGION: "srect",
  FLAG_TARGET_REGION: "trect",
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
    Hooks.on("preCreateToken", this._onPreCreateToken.bind(this));
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

  _isTaggedRegion(drawing, tags) {
    return drawing.type == CONST.DRAWING_TYPES.RECTANGLE &&
        this._isUserGamemaster(drawing.author) &&
        (tags.constructor === Array
            ? tags.some(t => drawing.text.startsWith(t))
            : drawing.text.startsWith(tags));
  }

  _getRegionTag(drawing, tag) {
    return this._isTaggedRegion(drawing, tag) ? drawing.text.substring(tag.length) : null;
  }

  _isReplicatedToken(token) {
    return (MLT.SCOPE in token.flags) &&
        (MLT.FLAG_SOURCE_TOKEN in token.flags[MLT.SCOPE]);
  }

  _isTokenInRegion(token, scene, region) {
    const tokenX = token.x + token.width * scene.data.grid / 2;
    const tokenY = token.y + token.height * scene.data.grid / 2;
    return tokenX >= region.x && tokenX <= region.x + region.width &&
           tokenY >= region.y && tokenY <= region.y + region.height;
  }

  _mapTokenPosition(token, sourceScene, sourceRegion, targetScene, targetRegion) {
    const tokenX = token.x + token.width * sourceScene.data.grid / 2;
    const tokenY = token.y + token.height * sourceScene.data.grid / 2;
    const targetX = targetRegion.x +
        (tokenX - sourceRegion.x) * (targetRegion.width / sourceRegion.width);
    const targetY = targetRegion.y +
        (tokenY - sourceRegion.y) * (targetRegion.height / sourceRegion.height);
    return {
      x: targetX - token.width * targetScene.data.grid / 2,
      y: targetY - token.height * targetScene.data.grid / 2
    };
  }

  _getScaleFactor(sourceScene, sourceRegion, targetScene, targetRegion) {
    return Math.min((targetRegion.width / targetScene.data.grid) / (sourceRegion.width / sourceScene.data.grid),
                    (targetRegion.height / targetScene.data.grid) / (sourceRegion.height/ sourceScene.data.grid));
  }

  _getReplicatedTokenCreateData(token, sourceScene, sourceRegion, targetScene, targetRegion) {
    const targetPosition =
        this._mapTokenPosition(token, sourceScene, sourceRegion, targetScene, targetRegion);
    const targetScaleFactor = this._getScaleFactor(sourceScene, sourceRegion, targetScene, targetRegion);

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
    data.flags[MLT.SCOPE][MLT.FLAG_SOURCE_REGION] = sourceRegion._id;
    data.flags[MLT.SCOPE][MLT.FLAG_TARGET_REGION] = targetRegion._id;
    return data;
  }

  _getReplicatedTokenUpdateData(sourceToken, replicatedToken, sourceScene, sourceRegion, targetScene, targetRegion) {
    const data = this._getReplicatedTokenCreateData(sourceToken, sourceScene, sourceRegion, targetScene, targetRegion);
    data._id = replicatedToken._id;
    delete data.flags;
    return data;
  }

  _getLinkedRegionsByTag(region, regionTag, resultTags) {
    const id = this._getRegionTag(region, regionTag);
    if (!id) {
      return [];
    }
    return game.scenes.map(scene => scene.data.drawings
        .filter(drawing => drawing._id !== region._id && (resultTags.constructor === Array
            ? resultTags.some(t => this._getRegionTag(drawing, t) === id)
            : this._getRegionTag(drawing, resultTags) === id))
        .map(result => [region, scene, result])
    ).flat();
  }

  _getTaggedRegionsContainingToken(token, tags) {
    const sourceScene = this._sceneOfToken(token._id);
    return sourceScene.data.drawings
        .filter(drawing => this._isTaggedRegion(drawing, tags) &&
                           this._isTokenInRegion(token, sourceScene, drawing));
  }

  _getReplicatedTokensForSourceToken(sourceToken, f) {
    return game.scenes.map(scene => scene.data.tokens
        .filter(token => this._isReplicatedToken(token) &&
                         token.flags[MLT.SCOPE][MLT.FLAG_SOURCE_TOKEN] === sourceToken._id)
        .map(token => [scene, token])
    ).flat();
  }

  _getReplicatedTokensForRegion(region, f) {
    return game.scenes.map(scene => scene.data.tokens
        .filter(token => this._isReplicatedToken(token) &&
                         (token.flags[MLT.SCOPE][MLT.FLAG_SOURCE_REGION] === region._id ||
                          token.flags[MLT.SCOPE][MLT.FLAG_TARGET_REGION] === region._id))
        .map(token => [scene, token])
    ).flat();
  }

  _getTokensToReplicateForRegion(sourceScene, sourceRegion) {
    return sourceScene.data.tokens
        .filter(token => this._isTokenInRegion(token, sourceScene, sourceRegion) &&
                         !this._isReplicatedToken(token));
  }

  _replicateTokenFromRegionToRegion(requestBatch, token, sourceRegion, targetRegion) {
    const sourceScene = this._sceneOfDrawing(sourceRegion._id);
    if (this._sceneOfToken(token._id) !== sourceScene ||
        this._isReplicatedToken(token) || !this._isTokenInRegion(token, sourceScene, sourceRegion)) {
      return;
    }

    const targetScene = this._sceneOfDrawing(targetRegion._id);
    requestBatch.createToken(targetScene,
        this._getReplicatedTokenCreateData(token, sourceScene, sourceRegion, targetScene, targetRegion));
  }

  _updateReplicatedToken(requestBatch, sourceToken, replicatedToken, sourceRegion, targetRegion) {
    const sourceScene = this._sceneOfDrawing(sourceRegion._id);
    const targetScene = this._sceneOfDrawing(targetRegion._id);
    if (this._sceneOfToken(sourceToken._id) !== sourceScene ||
        this._sceneOfToken(replicatedToken._id) !== targetScene ||
        this._isReplicatedToken(sourceToken) || !this._isReplicatedToken(replicatedToken) ||
        !this._isTokenInRegion(sourceToken, sourceScene, sourceRegion)) {
      return;
    }

    requestBatch.updateToken(targetScene,
        this._getReplicatedTokenUpdateData(sourceToken, replicatedToken, sourceScene, sourceRegion, targetScene, targetRegion));
  }

  _replicateTokenToAllRegions(requestBatch, token) {
    if (this._isReplicatedToken(token)) {
      return;
    }

    this._getTaggedRegionsContainingToken(token, MLT.TAG_SOURCE)
        .flatMap(r => this._getLinkedRegionsByTag(r, MLT.TAG_SOURCE, MLT.TAG_TARGET))
        .forEach(([sourceRegion, _, targetRegion]) =>
            this._replicateTokenFromRegionToRegion(requestBatch, token, sourceRegion, targetRegion));
  }

  _updateAllReplicatedTokens(requestBatch, token) {
    if (this._isReplicatedToken(token)) {
      return;
    }

    const mappedRegions =  this._getTaggedRegionsContainingToken(token, MLT.TAG_SOURCE)
        .flatMap(r => this._getLinkedRegionsByTag(r, MLT.TAG_SOURCE, MLT.TAG_TARGET));

    const tokensToDelete = [];
    const tokensToUpdate = [];
    this._getReplicatedTokensForSourceToken(token).forEach(([scene, replicatedToken]) => {
      const mappedRegion = mappedRegions.find(([sourceRegion, _, targetRegion]) =>
          replicatedToken.flags[MLT.SCOPE][MLT.FLAG_SOURCE_REGION] === sourceRegion._id &&
          replicatedToken.flags[MLT.SCOPE][MLT.FLAG_TARGET_REGION] === targetRegion._id);

      if (mappedRegion) {
        tokensToUpdate.push([mappedRegion[0], mappedRegion[2], replicatedToken]);
      } else {
        tokensToDelete.push([scene, replicatedToken]);
      }
    });
    const tokensToCreate = mappedRegions
        .filter(([s0, _, t0]) => !tokensToUpdate.some(([s1, t1, _]) => s0._id === s1._id && t0._id === t1._id));

    tokensToDelete.forEach(([scene, t]) => requestBatch.deleteToken(scene, t._id));
    tokensToUpdate.forEach(([sourceRegion, targetRegion, t]) =>
        this._updateReplicatedToken(requestBatch, token, t, sourceRegion, targetRegion));
    tokensToCreate.forEach(([sourceRegion, _, targetRegion]) =>
        this._replicateTokenFromRegionToRegion(requestBatch, token, sourceRegion, targetRegion));
  }

  _replicateAllFromSourceRegion(requestBatch, sourceRegion) {
    const sourceScene = this._sceneOfDrawing(sourceRegion._id);
    const tokens = this._getTokensToReplicateForRegion(sourceScene, sourceRegion);
    this._getLinkedRegionsByTag(sourceRegion, MLT.TAG_SOURCE, MLT.TAG_TARGET)
        .forEach(([_0, _1, targetRegion]) =>
            tokens.forEach(token => this._replicateTokenFromRegionToRegion(requestBatch, token, sourceRegion, targetRegion)));
  }

  _replicateAllToTargetRegion(requestBatch, targetRegion) {
    this._getLinkedRegionsByTag(targetRegion, MLT.TAG_TARGET, MLT.TAG_SOURCE)
      .forEach(([_, sourceScene, sourceRegion]) =>
          this._getTokensToReplicateForRegion(sourceScene, sourceRegion)
              .forEach(token => this._replicateTokenFromRegionToRegion(requestBatch, token, sourceRegion, targetRegion)));
  }

  _removeReplicationsForSourceToken(requestBatch, token) {
    this._getReplicatedTokensForSourceToken(token)
        .forEach(([scene, t]) => requestBatch.deleteToken(scene, t._id));
  }

  _removeReplicationsForRegion(requestBatch, region) {
    this._getReplicatedTokensForRegion(region)
        .forEach(([scene, t]) => requestBatch.deleteToken(scene, t._id));
  }

  _execute(requestBatch) {
    // isUndo: true prevents these commands from being undoable themselves.
    const options = {isUndo: true};
    options[MLT.REPLICATED_UPDATE] = true;

    let promise = Promise.resolve(null);
    for (const [sceneId, data] of Object.entries(requestBatch._scenes)) {
      const scene = game.scenes.get(sceneId);
      if (scene && data.delete.length) {
        promise = promise.then(() => scene.deleteEmbeddedEntity(Token.embeddedName, data.delete, options));
      }
      if (scene && data.update.length) {
        promise = promise.then(() => scene.updateEmbeddedEntity(Token.embeddedName, data.update,
                                                                Object.assign({diff: true}, options)));
      }
      if (scene && data.create.length) {
        promise = promise.then(() => scene.createEmbeddedEntity(Token.embeddedName, data.create, options));
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
            .filter(r => this._isTaggedRegion(r, MLT.TAG_SOURCE))
            .forEach(r => this._replicateAllFromSourceRegion(requestBatch, r));
      });
    });
  }

  _setLastTeleport(token) {
    if (game.user.isGM) {
      this._lastTeleport[token._id] =
          this._getTaggedRegionsContainingToken(token, [MLT.TAG_IN, MLT.TAG_INOUT]).map(r => r._id);
    }
  }

  _doTeleport(token) {
    if (!this._isPrimaryGamemaster()) {
      return;
    }

    const tokenScene = this._sceneOfToken(token._id);
    let lastTeleport = this._lastTeleport[token._id];
    let inRegions = this._getTaggedRegionsContainingToken(token, [MLT.TAG_IN, MLT.TAG_INOUT]);
    if (lastTeleport) {
      lastTeleport = lastTeleport.filter(id => inRegions.some(r => r._id === id));
      inRegions = inRegions.filter(r => !lastTeleport.includes(r._id));
      if (lastTeleport.length) {
        this._lastTeleport[token._id] = lastTeleport;
      } else {
        delete this._lastTeleport[token._id];
      }
    }
    if (!inRegions.length) {
      return;
    }

    const inRegion = inRegions[Math.floor(inRegions.length * Math.random())];
    const inTag = this._isTaggedRegion(inRegion, MLT.TAG_IN) ? MLT.TAG_IN : MLT.TAG_INOUT;
    const outRegions = this._getLinkedRegionsByTag(inRegion, inTag, [MLT.TAG_OUT, MLT.TAG_INOUT]);
    if (!outRegions.length) {
      return;
    }

    const outRegion = outRegions[Math.floor(outRegions.length * Math.random())];
    const position = this._mapTokenPosition(token, tokenScene, inRegion, outRegion[1], outRegion[2]);
    if (outRegion[1] === tokenScene) {
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
        requestBatch.createToken(outRegion[1], data);
        owners.forEach(user => {
          requestBatch.extraAction(() => game.socket.emit("pullToScene", outRegion[1]._id, user._id));
        })
      });
    }
  }

  _allowTokenOperation(token, options) {
    return !this._isReplicatedToken(token) || (MLT.REPLICATED_UPDATE in options);
  }

  _onReady() {
    // Replications might be out of sync if there was previously no GM and we just logged in.
    if (this._isOnlyGamemaster()) {
      this.refreshAll();
    }
  }

  _onCreateDrawing(scene, drawing, options, userId) {
    if (this._isTaggedRegion(drawing, MLT.TAG_SOURCE)) {
      const d = duplicate(drawing);
      this._queueAsync(requestBatch => this._replicateAllFromSourceRegion(requestBatch, d));
    } else if (this._isTaggedRegion(drawing, MLT.TAG_TARGET)) {
      const d = duplicate(drawing);
      this._queueAsync(requestBatch => this._replicateAllToTargetRegion(requestBatch, d));
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
    if (this._isTaggedRegion(drawing, [MLT.TAG_SOURCE, MLT.TAG_TARGET])) {
      const d = duplicate(drawing);
      this._queueAsync(requestBatch => this._removeReplicationsForRegion(requestBatch, d));
    }
  }

  _onPreCreateToken(scene, token, options, userId) {
    return this._allowTokenOperation(token, options);
  }

  _onCreateToken(scene, token, options, userId) {
    if (!this._isReplicatedToken(token)) {
      const t = duplicate(token);
      this._queueAsync(requestBatch => this._replicateTokenToAllRegions(requestBatch, t));
      this._setLastTeleport(t);
    }
  }

  _onPreUpdateToken(scene, token, update, options, userId) {
    return this._allowTokenOperation(token, options) ||
           // Also allow in case it's a replication that got out of sync somehow.
           !this._drawingById(token.flags[MLT.SCOPE][MLT.FLAG_SOURCE_REGION]) ||
           !this._drawingById(token.flags[MLT.SCOPE][MLT.FLAG_TARGET_REGION]);
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
    return this._onPreUpdateToken(scene, token, {}, options, userId);
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
