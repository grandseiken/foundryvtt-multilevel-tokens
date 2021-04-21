const MLT = {
  SCOPE: "multilevel-tokens",
  ENTER: "enter",
  LEAVE: "leave",
  MOVE: "move",
  SETTING_AUTO_TARGET: "autotarget",
  SETTING_AUTO_CHAT_BUBBLE: "autochatbubble",
  SETTING_CLONE_MODULE_FLAGS: "clonemoduleflags",
  DEFAULT_TINT_COLOR: "#808080",
  FLAG_SOURCE_SCENE: "sscene",
  FLAG_SOURCE_TOKEN: "stoken",
  FLAG_SOURCE_REGION: "srect",
  FLAG_TARGET_REGION: "trect",
  REPLICATED_UPDATE: "mlt_bypass",
  LOG_PREFIX: "Multilevel Tokens | ",
  TOKEN_STAIRS: "@stairs",
};

class MltRequestBatch {
  constructor() {
    this._scenes = {};
    this._extraActions = [];
  }

  createToken(scene, data) {
    this._scene(scene).create.push(data);
  }

  deleteToken(scene, id) {
    this._scene(scene).delete.push(id);
  }

  updateToken(scene, data, animate=true, diff=true) {
    (!animate ? this._scene(scene).updateInstant :
     diff ? this._scene(scene).updateAnimateDiff : this._scene(scene).updateAnimated).push(data);
  }

  updateDrawing(scene, data) {
    this._scene(scene).updateDrawing.push(data);
  }

  updateTile(scene, data) {
    this._scene(scene).updateTile.push(data);
  }

  updateWall(scene, data) {
    this._scene(scene).updateWall.push(data);
  }

  updateMapNote(scene, data) {
    this._scene(scene).updateMapNote.push(data);
  }

  updateLight(scene, data) {
    this._scene(scene).updateLight.push(data);
  }

  updateSound(scene, data) {
    this._scene(scene).updateSound.push(data);
  }

  extraAction(f) {
    this._extraActions.push(f);
  }

  _scene(scene) {
    if (!(scene._id in this._scenes)) {
      this._scenes[scene._id] = {
        create: [],
        updateAnimateDiff: [],
        updateAnimated: [],
        updateInstant: [],
        updateDrawing: [],
        updateTile: [],
        updateWall: [],
        updateMapNote: [],
        updateLight: [],
        updateSound: [],
        delete: []};
    }
    return this._scenes[scene._id];
  }
}

class MultilevelTokens {
  constructor() {
    game.settings.register(MLT.SCOPE, MLT.SETTING_AUTO_TARGET, {
      name: game.i18n.localize("MLT.SettingAutoSyncTargets"),
      hint: game.i18n.localize("MLT.SettingAutoSyncTargetsHint"),
      scope: "world",
      config: true,
      type: Boolean,
      default: true
    });
    game.settings.register(MLT.SCOPE, MLT.SETTING_AUTO_CHAT_BUBBLE, {
      name: game.i18n.localize("MLT.SettingAutoSyncChatBubbles"),
      hint: game.i18n.localize("MLT.SettingAutoSyncChatBubblesHint"),
      scope: "world",
      config: true,
      type: Boolean,
      default: true
    });
    // TODO: maybe be necessary to decide this on a module-by-module basis. Could provide a way to let the user decide,
    // and / or just bake in defaults for known cases where it matters.
    game.settings.register(MLT.SCOPE, MLT.SETTING_CLONE_MODULE_FLAGS, {
      name: game.i18n.localize("MLT.SettingCloneModuleFlags"),
      hint: game.i18n.localize("MLT.SettingCloneModuleFlagsHint"),
      scope: "world",
      config: true,
      type: Boolean,
      default: true
    });
    Hooks.on("ready", this._onReady.bind(this));
    Hooks.on("createScene", this.refreshAll.bind(this));
    Hooks.on("updateScene", this._onUpdateScene.bind(this));
    Hooks.on("deleteScene", this.refreshAll.bind(this));
    Hooks.on("createDrawing", this._onCreateDrawing.bind(this));
    Hooks.on("preUpdateDrawing", this._onPreUpdateDrawing.bind(this));
    Hooks.on("updateDrawing", this._onUpdateDrawing.bind(this));
    Hooks.on("deleteDrawing", this._onDeleteDrawing.bind(this));
    Hooks.on("preCreateToken", this._onPreCreateToken.bind(this));
    Hooks.on("createToken", this._onCreateToken.bind(this));
    Hooks.on("preUpdateToken", this._onPreUpdateToken.bind(this));
    Hooks.on("updateToken", this._onUpdateToken.bind(this));
    Hooks.on("controlToken", this._onControlToken.bind(this));
    Hooks.on("preDeleteToken", this._onPreDeleteToken.bind(this));
    Hooks.on("deleteToken", this._onDeleteToken.bind(this));
    Hooks.on("targetToken", this._onTargetToken.bind(this));
    Hooks.on("hoverNote", this._onHoverNote.bind(this));
    Hooks.on("preCreateCombatant", this._onPreCreateCombatant.bind(this));
    Hooks.on("chatMessage", this._onChatMessage.bind(this));
    Hooks.on("createChatMessage", this._onCreateChatMessage.bind(this));
    Hooks.on("renderDrawingConfig", this._onRenderDrawingConfig.bind(this));
    this._lastTeleport = {};
    this._lastMacro = {};
    this._chatMacroSpeaker = null;
    this._asyncQueue = null;
    this._asyncCount = 0;
    this._overrideNotesDisplay = false;
    console.log(MLT.LOG_PREFIX, "Initialized");
  }

  _rotate(centre, point, degrees) {
    const r = degrees * Math.PI / 180;
    return {
      x: centre.x + (point.x - centre.x) * Math.cos(r) - (point.y - centre.y) * Math.sin(r),
      y: centre.y + (point.x - centre.x) * Math.sin(r) + (point.y - centre.y) * Math.cos(r),
    };
  }

  _isUserGamemaster(userId) {
    const user = game.users.get(userId);
    return user ? user.role === CONST.USER_ROLES.GAMEMASTER : true;
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

  _isAuthorisedRegion(drawing) {
    return (drawing.type === CONST.DRAWING_TYPES.RECTANGLE ||
            drawing.type === CONST.DRAWING_TYPES.ELLIPSE ||
            drawing.type === CONST.DRAWING_TYPES.POLYGON) &&
        this._isUserGamemaster(drawing.author);
  }

  _hasRegionFlag(drawing, flagNames) {
    if (!this._isAuthorisedRegion(drawing)) {
      return false;
    }
    let flags = drawing.flags;
    if (!flags) {
      return false;
    }
    flags = flags[MLT.SCOPE];
    return flags && !flags.disabled && (flagNames.constructor === Array
        ? flagNames.some(f => flags[f] ? true : false)
        : flags[flagNames] ? true : false);
  }

  _getRegionFlag(drawing, flagName) {
    if (!this._isAuthorisedRegion(drawing)) {
      return null;
    }
    let flags = drawing.flags;
    if (!flags) {
      return null;
    }
    flags = flags[MLT.SCOPE];
    return flags && !flags.disabled ? flags[flagName] : null;
  }

  _isReplicatedToken(token) {
    return token.flags && (MLT.SCOPE in token.flags) && (MLT.FLAG_SOURCE_TOKEN in token.flags[MLT.SCOPE]);
  }

  _isProperToken(token) {
    return !this._isReplicatedToken(token) && token.name !== MLT.TOKEN_STAIRS;
  }

  _getSourceSceneForReplicatedToken(scene, token) {
    return (MLT.FLAG_SOURCE_SCENE in token.flags[MLT.SCOPE])
        ? game.scenes.get(token.flags[MLT.SCOPE][MLT.FLAG_SOURCE_SCENE])
        : scene;
  }

  _getSourceTokenForReplicatedToken(scene, token) {
    const sourceScene = this._getSourceSceneForReplicatedToken(scene, token);
    return sourceScene && sourceScene.data.tokens.find(t => t._id === token.flags[MLT.SCOPE][MLT.FLAG_SOURCE_TOKEN]);
  }

  _getAllLinkedCanvasTokens(token) {
    return canvas.tokens.placeables.filter(t => {
      if (this._isReplicatedToken(token)) {
        return this._isReplicatedToken(t.data)
            ? t.data.flags[MLT.SCOPE][MLT.FLAG_SOURCE_SCENE] === token.flags[MLT.SCOPE][MLT.FLAG_SOURCE_SCENE] &&
              t.data.flags[MLT.SCOPE][MLT.FLAG_SOURCE_TOKEN] === token.flags[MLT.SCOPE][MLT.FLAG_SOURCE_TOKEN]
            : !(MLT.FLAG_SOURCE_SCENE in token.flags[MLT.SCOPE]) &&
            token.flags[MLT.SCOPE][MLT.FLAG_SOURCE_TOKEN] === t.data._id;
      } else {
        return this._isReplicatedToken(t.data) &&
            !(MLT.FLAG_SOURCE_SCENE in t.data.flags[MLT.SCOPE]) &&
            t.data.flags[MLT.SCOPE][MLT.FLAG_SOURCE_TOKEN] === token._id;
      }
    });
  }

  _isInvalidReplicatedToken(scene, token) {
    if (!scene.data.drawings.some(d => d._id === token.flags[MLT.SCOPE][MLT.FLAG_TARGET_REGION])) {
      return true;
    }
    const sourceScene = this._getSourceSceneForReplicatedToken(scene, token);
    if (!sourceScene) {
      return false;
    }
    return !sourceScene.data.drawings.some(d => d._id === token.flags[MLT.SCOPE][MLT.FLAG_SOURCE_REGION]) ||
           !sourceScene.data.tokens.some(t => t._id === token.flags[MLT.SCOPE][MLT.FLAG_SOURCE_TOKEN]);
  }

  _isReplicationForSourceToken(sourceScene, sourceToken, targetScene, targetToken) {
    return targetToken.flags[MLT.SCOPE][MLT.FLAG_SOURCE_TOKEN] === sourceToken._id &&
        (MLT.FLAG_SOURCE_SCENE in targetToken.flags[MLT.SCOPE]
            ? targetToken.flags[MLT.SCOPE][MLT.FLAG_SOURCE_SCENE] === sourceScene._id
            : sourceScene === targetScene);
  }

  _isReplicationForSourceRegion(scene, region, targetScene, targetToken) {
    return targetToken.flags[MLT.SCOPE][MLT.FLAG_SOURCE_REGION] === region._id &&
        (MLT.FLAG_SOURCE_SCENE in targetToken.flags[MLT.SCOPE]
            ? targetToken.flags[MLT.SCOPE][MLT.FLAG_SOURCE_SCENE] === scene._id
            : scene === targetScene);
  }

  _isReplicationForTargetRegion(scene, region, targetScene, targetToken) {
    return scene === targetScene && targetToken.flags[MLT.SCOPE][MLT.FLAG_TARGET_REGION] === region._id;
  }

  _isReplicationForRegion(scene, region, targetScene, targetToken) {
    return this._isReplicationForTargetRegion(scene, region, targetScene, targetToken) ||
           this._isReplicationForSourceRegion(scene, region, targetScene, targetToken);
  }

  _getDrawingCentre(drawing) {
    return {
      x: drawing.x + drawing.width / 2,
      y: drawing.y + drawing.height / 2
    };
  }

  _getSceneScaleFactor(scene) {
    const hexScale = 2 / Math.sqrt(3);
    return {
      x: scene.data.gridType === GRID_TYPES.HEXODDR || scene.data.gridType === GRID_TYPES.HEXEVENR ? hexScale : 1,
      y: scene.data.gridType === GRID_TYPES.HEXODDQ || scene.data.gridType === GRID_TYPES.HEXEVENQ ? hexScale : 1,
    };
  }

  _getTokenCentre(scene, token) {
    const s = this._getSceneScaleFactor(scene);
    return {
      x: token.x + token.width * s.x * scene.data.grid / 2,
      y: token.y + token.height * s.y * scene.data.grid / 2
    };
  }

  _getTokenPositionFromCentre(scene, token, centre) {
    const s = this._getSceneScaleFactor(scene);
    return {
      x: centre.x - token.width * s.x * scene.data.grid / 2,
      y: centre.y - token.height * s.y * scene.data.grid / 2
    }
  }

  _isPointInRegion(point, region) {
    if (region.rotation) {
      point = this._rotate(this._getDrawingCentre(region), point, -region.rotation);
    }

    const inBox = point.x >= region.x && point.x <= region.x + region.width &&
                  point.y >= region.y && point.y <= region.y + region.height;
    if (!inBox) {
      return false;
    }
    if (region.type === CONST.DRAWING_TYPES.RECTANGLE) {
      return true;
    }
    if (region.type === CONST.DRAWING_TYPES.ELLIPSE) {
      if (!region.width || !region.height) {
        return false;
      }
      const dx = region.x + region.width / 2 - point.x;
      const dy = region.y + region.height / 2 - point.y;
      return 4 * (dx * dx) / (region.width * region.width) + 4 * (dy * dy) / (region.height * region.height) <= 1;
    }
    if (region.type === CONST.DRAWING_TYPES.POLYGON) {
      const cx = point.x - region.x;
      const cy = point.y - region.y;
      let w = 0;
      for (let i0 = 0; i0 < region.points.length; ++i0) {
        let i1 = i0 + 1 === region.points.length ? 0 : i0 + 1;
        if (region.points[i0][1] <= cy && region.points[i1][1] > cy &&
            (region.points[i1][0] - region.points[i0][0]) * (cy - region.points[i0][1]) -
            (region.points[i1][1] - region.points[i0][1]) * (cx - region.points[i0][0]) > 0) {
          ++w;
        }
        if (region.points[i0][1] > cy && region.points[i1][1] <= cy &&
            (region.points[i1][0] - region.points[i0][0]) * (cy - region.points[i0][1]) -
            (region.points[i1][1] - region.points[i0][1]) * (cx - region.points[i0][0]) < 0) {
          --w;
        }
      }
      return w !== 0;
    }
    return false;
  }

  _isTokenInRegion(scene, token, region) {
    return this._isPointInRegion(this._getTokenCentre(scene, token), region);
  }

  _isPointInToken(scene, point, containingToken) {
    return containingToken.x <= point.x && point.x <= containingToken.x + (containingToken.width * scene.data.grid) &&
           containingToken.y <= point.y && point.y <= containingToken.y + (containingToken.height * scene.data.grid);
  }

  _mapPosition(point, sourceRegion, targetRegion) {
    if (sourceRegion.rotation) {
      point = this._rotate(this._getDrawingCentre(sourceRegion), point, -sourceRegion.rotation);
    }

    const px = (point.x - sourceRegion.x) * (targetRegion.width / sourceRegion.width);
    const py = (point.y - sourceRegion.y) * (targetRegion.height / sourceRegion.height);
    let target = {
      x: this._hasRegionFlag(targetRegion, "flipX")
          ? targetRegion.x + targetRegion.width - px
          : targetRegion.x + px,
      y: this._hasRegionFlag(targetRegion, "flipY")
          ? targetRegion.y + targetRegion.height - py
          : targetRegion.y + py,
    };
    if (targetRegion.rotation) {
      target = this._rotate(this._getDrawingCentre(targetRegion), target, targetRegion.rotation);
    }
    return target;
  }

  _getReplicatedTokenCreateData(sourceScene, token, sourceRegion, targetScene, targetRegion) {
    const extraScale = this._getRegionFlag(targetRegion, "scale") || 1;
    const sourceScale = this._getSceneScaleFactor(sourceScene);
    const targetScale = this._getSceneScaleFactor(targetScene);
    const scale = {
      x: Math.abs(extraScale * (sourceScale.x / targetScale.x) *
            (targetRegion.width / targetScene.data.grid) / (sourceRegion.width / sourceScene.data.grid)),
      y: Math.abs(extraScale * (sourceScale.y / targetScale.y) *
            (targetRegion.height / targetScene.data.grid) / (sourceRegion.height / sourceScene.data.grid)),
    };
    const targetCentre = this._mapPosition(this._getTokenCentre(sourceScene, token), sourceRegion, targetRegion);

    const tintRgb = token.tint ? hexToRGB(colorStringToHex(token.tint)) : [1., 1., 1.];
    const multRgb = hexToRGB(colorStringToHex(
        this._getRegionFlag(targetRegion, "tintColor") || MLT.DEFAULT_TINT_COLOR));
    for (let i = 0; i < multRgb.length; ++i) {
      tintRgb[i] *= multRgb[i];
    }
    const cloneModuleFlags = game.settings.get(MLT.SCOPE, MLT.SETTING_CLONE_MODULE_FLAGS) || false;

    const data = duplicate(token);
    delete data._id;
    data.actorId = "";
    data.actorLink = false;
    data.vision = false;
    data.width *= scale.x;
    data.height *= scale.y;
    // Workaround for Foundry behaviour in which image is scaled down to fit if token width is reduced, but not if
    // height is reduced.
    if (scale.y < scale.x) {
      data.scale = data.scale ? data.scale * scale.y / scale.x : scale.y / scale.x;
    }

    const targetPosition = this._getTokenPositionFromCentre(targetScene, data, targetCentre);
    data.x = targetPosition.x;
    data.y = targetPosition.y;
    data.rotation += targetRegion.rotation - sourceRegion.rotation;
    data.tint = "#" + rgbToHex(tintRgb).toString(16);
    if (!data.flags || !cloneModuleFlags) {
      data.flags = {};
    }
    data.flags[MLT.SCOPE] = {};
    if (sourceScene !== targetScene) {
      data.flags[MLT.SCOPE][MLT.FLAG_SOURCE_SCENE] = sourceScene._id;
    }
    data.flags[MLT.SCOPE][MLT.FLAG_SOURCE_TOKEN] = token._id;
    data.flags[MLT.SCOPE][MLT.FLAG_SOURCE_REGION] = sourceRegion._id;
    data.flags[MLT.SCOPE][MLT.FLAG_TARGET_REGION] = targetRegion._id;
    return data;
  }

  _getReplicatedTokenUpdateData(sourceScene, sourceToken,  sourceRegion, targetScene, targetToken, targetRegion) {
    const data = this._getReplicatedTokenCreateData(sourceScene, sourceToken, sourceRegion, targetScene, targetRegion);
    data._id = targetToken._id;
    delete data.flags;
    return data;
  }

  _getLinkedRegionsByFlag(scene, region, idFlag, filterFlags) {
    const id = this._getRegionFlag(region, idFlag);
    if (!id) {
      return [];
    }
    const flagMatch = d => this._hasRegionFlag(d, filterFlags) && this._getRegionFlag(d, idFlag) === id;
    if (this._hasRegionFlag(region, "local")) {
      return scene.data.drawings
          .filter(d => d._id !== region._id && flagMatch(d))
          .map(result => [region, scene, result]);
    }
    return game.scenes.map(resultScene => resultScene.data.drawings
        .filter(d => (d._id !== region._id || scene !== resultScene) && flagMatch(d))
        .map(result => [region, resultScene, result])
    ).flat();
  }

  _getNumericallyAdjacentLevelRegions(scene, levelRegion) {
    const levelNumber = parseInt(this._getRegionFlag(levelRegion, "levelNumber"));
    return scene.data.drawings.filter(d => {
      const otherNumber = parseInt(this._getRegionFlag(d, "levelNumber"));
      return otherNumber == levelNumber + 1 || otherNumber == levelNumber - 1;
    });
  }

  _getFlaggedRegionsContainingPoint(scene, point, flags) {
    return scene.data.drawings
        .filter(drawing => this._hasRegionFlag(drawing, flags) &&
                           this._isPointInRegion(point, drawing));
  }

  _getFlaggedRegionsContainingToken(scene, token, flags) {
    return this._getFlaggedRegionsContainingPoint(scene, this._getTokenCentre(scene, token), flags);
  }

  _getTeleportRegionsForMapNote(scene, mapNote) {
    const epsilon = 1 / 8;
    const points = [
      {x: mapNote.x - epsilon, y: mapNote.y - epsilon},
      {x: mapNote.x - epsilon, y: mapNote.y + epsilon},
      {x: mapNote.x + epsilon, y: mapNote.y - epsilon},
      {x: mapNote.x + epsilon, y: mapNote.y + epsilon},
    ];
    return scene.data.drawings.filter(drawing =>
        this._hasRegionFlag(drawing, "in") && this._hasRegionFlag(drawing, "activateViaMapNote") &&
        points.some(p => this._isPointInRegion(p, drawing)));
  }

  _filterRegionsAndUpdateLastTeleport(token, inRegions) {
    let lastTeleport = this._lastTeleport[token._id];
    if (lastTeleport) {
      lastTeleport = lastTeleport.filter(id => inRegions.some(r => r._id === id));
      inRegions = inRegions.filter(r => !lastTeleport.includes(r._id));
      if (lastTeleport.length) {
        this._lastTeleport[token._id] = lastTeleport;
      } else {
        delete this._lastTeleport[token._id];
      }
    }
    return inRegions;
  }

  _getReplicatedTokensForSourceToken(sourceScene, sourceToken) {
    return game.scenes.map(scene => scene.data.tokens
        .filter(token => this._isReplicatedToken(token) &&
                         this._isReplicationForSourceToken(sourceScene, sourceToken, scene, token))
        .map(token => [scene, token])
    ).flat();
  }

  _getReplicatedTokensForSourceRegion(sourceScene, sourceRegion) {
    const scenes = this._hasRegionFlag(sourceRegion, "local") ? [sourceScene] : game.scenes;
    return scenes.map(s => s.data.tokens
        .filter(token => this._isReplicatedToken(token) &&
                         this._isReplicationForSourceRegion(sourceScene, sourceRegion, s, token))
        .map(token => [s, token])
    ).flat();
  }

  _getReplicatedTokensForTargetRegion(targetScene, targetRegion) {
    return targetScene.data.tokens
        .filter(token => this._isReplicatedToken(token) &&
                         this._isReplicationForTargetRegion(targetScene, targetRegion, targetScene, token))
        .map(token => [targetScene, token]);
  }

  _getReplicatedTokensForRegion(scene, region) {
    const scenes = this._hasRegionFlag(region, "source") && !this._hasRegionFlag(region, "local") ? game.scenes : [scene];
    return scenes.map(s => s.data.tokens
        .filter(token => this._isReplicatedToken(token) &&
                         this._isReplicationForRegion(scene, region, s, token))
        .map(token => [s, token])
    ).flat();
  }

  _getTokensToReplicateForRegion(scene, sourceRegion) {
    return scene.data.tokens
        .filter(token => this._isTokenInRegion(scene, token, sourceRegion) && this._isProperToken(token));
  }

  _replicateTokenFromRegionToRegion(requestBatch, scene, token, sourceRegion, targetScene, targetRegion) {
    if (!this._isProperToken(token) || !this._isTokenInRegion(scene, token, sourceRegion)) {
      return;
    }
    requestBatch.createToken(targetScene,
        this._getReplicatedTokenCreateData(scene, token, sourceRegion, targetScene, targetRegion));
  }

  _updateReplicatedToken(requestBatch, sourceScene, sourceToken, sourceRegion, targetScene, targetToken, targetRegion, keys) {
    if (!this._isProperToken(sourceToken) || !this._isReplicatedToken(targetToken) ||
        !this._isTokenInRegion(sourceScene, sourceToken, sourceRegion)) {
      return;
    }
    const updateData = this._getReplicatedTokenUpdateData(sourceScene, sourceToken, sourceRegion, targetScene, targetToken, targetRegion);
    var filteredUpdateData = updateData;
    if (keys) {
      filteredUpdateData = {};
      keys.forEach(k => {
        if (k in updateData) {
          filteredUpdateData[k] = updateData[k];
        }
      });
    }
    requestBatch.updateToken(targetScene, updateData, /* animate */ true, /* diff */ true);
  }

  _replicateTokenToAllRegions(requestBatch, scene, token) {
    if (!this._isProperToken(token)) {
      return;
    }

    this._getFlaggedRegionsContainingToken(scene, token, "source")
        .flatMap(r => this._getLinkedRegionsByFlag(scene, r, "cloneId", "target"))
        .forEach(([sourceRegion, targetScene, targetRegion]) =>
            this._replicateTokenFromRegionToRegion(requestBatch, scene, token, sourceRegion, targetScene, targetRegion));
  }

  _updateAllReplicatedTokensForTargetRegion(requestBatch, targetScene, targetRegion) {
    this._getReplicatedTokensForTargetRegion(targetScene, targetRegion)
        .forEach(([_, targetToken]) => {
          const sourceSceneId = targetToken.flags[MLT.SCOPE][MLT.FLAG_SOURCE_SCENE];
          const sourceScene = sourceSceneId ? game.scenes.get(sourceSceneId) : targetScene;
          if (!sourceScene) {
            return;
          }
          const sourceToken = sourceScene.data.tokens.find(t => t._id === targetToken.flags[MLT.SCOPE][MLT.FLAG_SOURCE_TOKEN]);
          const sourceRegion = sourceScene.data.drawings.find(d => d._id === targetToken.flags[MLT.SCOPE][MLT.FLAG_SOURCE_REGION]);
          if (sourceToken && sourceRegion) {
            this._updateReplicatedToken(requestBatch, sourceScene, sourceToken, sourceRegion, targetScene, targetToken, targetRegion);
          }
        });
  }

  _updateAllReplicatedTokensForSourceRegion(requestBatch, sourceScene, sourceRegion) {
    const tokens = this._getTokensToReplicateForRegion(sourceScene, sourceRegion);
    const replicatedTokens = this._getReplicatedTokensForSourceRegion(sourceScene, sourceRegion);

    replicatedTokens.forEach(([targetScene, targetToken]) => {
      const sourceToken = tokens.find(t => this._isReplicationForSourceToken(sourceScene, t, targetScene, targetToken));
      const targetRegion = targetScene.data.drawings.find(d => targetToken.flags[MLT.SCOPE][MLT.FLAG_TARGET_REGION] === d._id);
      if (sourceToken && targetRegion) {
        this._updateReplicatedToken(requestBatch, sourceScene, sourceToken, sourceRegion, targetScene, targetToken, targetRegion);
      } else {
        requestBatch.deleteToken(targetScene, targetToken._id);
      }
    });
    this._getLinkedRegionsByFlag(sourceScene, sourceRegion, "cloneId", "target")
        .forEach(([_0, targetScene, targetRegion]) =>
          tokens.forEach(token => {
            if (!replicatedTokens.some(([targetScene, targetToken]) =>
                    this._isReplicationForSourceRegion(sourceScene, sourceRegion, targetScene, targetToken) &&
                    this._isReplicationForSourceToken(sourceScene, token, targetScene, targetToken))) {
              this._replicateTokenFromRegionToRegion(requestBatch, sourceScene, token, sourceRegion, targetScene, targetRegion)
            }
          }));
  }

  _updateAllReplicatedTokensForToken(requestBatch, scene, token, keys) {
    if (!this._isProperToken(token)) {
      return;
    }

    const mappedRegions =  this._getFlaggedRegionsContainingToken(scene, token, "source")
        .flatMap(r => this._getLinkedRegionsByFlag(scene, r, "cloneId", "target"));

    const tokensToDelete = [];
    const tokensToUpdate = [];
    this._getReplicatedTokensForSourceToken(scene, token).forEach(([targetScene, targetToken]) => {
      const mappedRegion = mappedRegions.find(([sourceRegion, mapScene, mapRegion]) =>
          this._isReplicationForSourceRegion(scene, sourceRegion, targetScene, targetToken) &&
          this._isReplicationForTargetRegion(mapScene, mapRegion, targetScene, targetToken));

      if (mappedRegion) {
        tokensToUpdate.push([mappedRegion[0], targetScene, targetToken, mappedRegion[2]]);
      } else {
        tokensToDelete.push([targetScene, targetToken]);
      }
    });
    const tokensToCreate = mappedRegions.filter(([r0, s0, t0]) =>
        !tokensToUpdate.some(([r1, s1, _, t1]) => s0 === s1 && r0._id === r1._id && t0._id === t1._id));

    tokensToDelete.forEach(([scene, t]) => requestBatch.deleteToken(scene, t._id));
    tokensToUpdate.forEach(([sourceRegion, targetScene, t, targetRegion]) =>
        this._updateReplicatedToken(requestBatch, scene, token, sourceRegion, targetScene, t, targetRegion, keys));
    tokensToCreate.forEach(([sourceRegion, targetScene, targetRegion]) =>
        this._replicateTokenFromRegionToRegion(requestBatch, scene, token, sourceRegion, targetScene, targetRegion));
  }

  _replicateAllFromSourceRegion(requestBatch, sourceScene, sourceRegion) {
    const tokens = this._getTokensToReplicateForRegion(sourceScene, sourceRegion);
    this._getLinkedRegionsByFlag(sourceScene, sourceRegion, "cloneId", "target")
        .forEach(([_0, targetScene, targetRegion]) =>
            tokens.forEach(token =>
                this._replicateTokenFromRegionToRegion(requestBatch, sourceScene, token, sourceRegion, targetScene, targetRegion)));
  }

  _replicateAllToTargetRegion(requestBatch, targetScene, targetRegion) {
    this._getLinkedRegionsByFlag(targetScene, targetRegion, "cloneId", "source")
      .forEach(([_, sourceScene, sourceRegion]) =>
          this._getTokensToReplicateForRegion(sourceScene, sourceRegion)
              .forEach(token =>
                  this._replicateTokenFromRegionToRegion(requestBatch, sourceScene, token, sourceRegion, targetScene, targetRegion)));
  }

  _removeReplicationsForSourceToken(requestBatch, scene, token) {
    this._getReplicatedTokensForSourceToken(scene, token)
        .forEach(([s, t]) => requestBatch.deleteToken(s, t._id));
  }

  _removeReplicationsForRegion(requestBatch, scene, region) {
    this._getReplicatedTokensForRegion(scene, region)
        .forEach(([s, t]) => requestBatch.deleteToken(s, t._id));
  }

  _execute(requestBatch) {
    // isUndo: true prevents these commands from being undoable themselves.
    const options = {isUndo: true};
    options[MLT.REPLICATED_UPDATE] = true;

    let promise = Promise.resolve(null);
    for (const [sceneId, data] of Object.entries(requestBatch._scenes)) {
      const scene = game.scenes.get(sceneId);
      if (!scene) {
        continue;
      }
      if (data.delete.length) {
        // Also remove from combats.
        for (const combat of game.combats.entities) {
          if (combat.scene === scene) {
            const combatants = data.delete.map(id => combat.getCombatantByToken(id)).flatMap(c => c ? [c._id] : []);
            if (combatants.length) {
              promise = promise.then(() => combat.deleteEmbeddedEntity("Combatant", combatants));
            }
          }
        }
        promise = promise.then(() => scene.deleteEmbeddedEntity(Token.embeddedName, data.delete, options));
      }
      if (data.updateAnimateDiff.length) {
        promise = promise.then(() => scene.updateEmbeddedEntity(Token.embeddedName, data.updateAnimateDiff,
                                                                Object.assign({diff: true}, options)));
      }
      if (data.updateAnimated.length) {
        promise = promise.then(() => scene.updateEmbeddedEntity(Token.embeddedName, data.updateAnimated,
                                                                Object.assign({diff: false}, options)));
      }
      if (data.updateInstant.length) {
        promise = promise.then(() => scene.updateEmbeddedEntity(Token.embeddedName, data.updateInstant,
                                                                Object.assign({diff: false, animate: false}, options)));
      }
      if (data.updateTile.length) {
        promise = promise.then(() => scene.updateEmbeddedEntity(Tile.embeddedName, data.updateTile,
                                                                Object.assign({diff: false}, options)));
      }
      if (data.updateWall.length) {
        promise = promise.then(() => scene.updateEmbeddedEntity(Wall.embeddedName, data.updateWall,
                                                                Object.assign({diff: false}, options)));
      }
      if (data.updateDrawing.length) {
        promise = promise.then(() => scene.updateEmbeddedEntity(Drawing.embeddedName, data.updateDrawing,
                                                                Object.assign({diff: false}, options)));
      }
      if (data.updateMapNote.length) {
        promise = promise.then(() => scene.updateEmbeddedEntity(Note.embeddedName, data.updateMapNote,
                                                                Object.assign({diff: false}, options)));
      }
      if (data.updateLight.length) {
        promise = promise.then(() => scene.updateEmbeddedEntity(AmbientLight.embeddedName, data.updateLight,
                                                                Object.assign({diff: false}, options)));
      }
      if (data.updateSound.length) {
        promise = promise.then(() => scene.updateEmbeddedEntity(AmbientSound.embeddedName, data.updateSound,
                                                                Object.assign({diff: false}, options)));
      }
      if (data.create.length) {
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

  _setLastTeleport(scene, token) {
    if (game.user.isGM) {
      const teleportRegions = this._getFlaggedRegionsContainingToken(scene, token, ["in", "out"]);
      if (teleportRegions.length) {
        this._lastTeleport[token._id] = teleportRegions.map(r => r._id);
      } else {
        delete this._lastTeleport[token._id];
      }
    }
  }

  _initializeLastTeleportAndMacroTracking() {
    if (game.user.isGM) {
      game.scenes.forEach(scene => scene.data.tokens.forEach(token => {
        this._setLastTeleport(scene, token);
        const macroRegions = this._getFlaggedRegionsContainingToken(scene, token, ["macroEnter", "macroLeave", "macroMove"]);
        if (macroRegions.length) {
          this._lastMacro[token._id] = macroRegions.map(r => r._id);
        }
      }));
    }
  }

  _getMacroArgs(region) {
    const argString = this._getRegionFlag(region, "macroArgs") || "";
    const regex = /(".*?"|[^",\s]([^",]*[^",\s])?)(?=\s*,|\s*$)/g;
    return (argString.match(regex) || []).map(s =>
        s.startsWith(`"`) && s.endsWith(`"`) ? s.substring(1, s.length - 1) :
        s === "true" ? true :
        s === "false" ? false :
        !isNaN(s) ? +s : s);
  }

  _doMacros(scene, token) {
    if (!game.user.isGM) {
      return;
    }

    const currentMacroRegions = this._getFlaggedRegionsContainingToken(scene, token, ["macroEnter", "macroLeave", "macroMove"]);
    const previousMacroRegionIds = this._lastMacro[token._id] || [];
    if (currentMacroRegions.length) {
      this._lastMacro[token._id] = currentMacroRegions.map(r => r._id);
    } else {
      delete this._lastMacro[token._id];
    }
    if (!this._isPrimaryGamemaster()) {
      return false;
    }

    const enteredMacroRegions = currentMacroRegions.flatMap(r =>
        this._hasRegionFlag(r, "macroEnter") && !previousMacroRegionIds.includes(r._id) ? [[r, MLT.ENTER]] : []);
    const movedMacroRegions = currentMacroRegions.flatMap(r =>
        this._hasRegionFlag(r, "macroMove") && previousMacroRegionIds.includes(r._id) ? [[r, MLT.MOVE]] : []);
    const leftMacroRegions = previousMacroRegionIds.flatMap(id => {
        const r = scene.data.drawings.find(d => d._id === id);
        return r && this._hasRegionFlag(r, "macroLeave") && !currentMacroRegions.some(s => s._id === id) ? [[r, MLT.LEAVE]] : [];
    });

    for (const region of enteredMacroRegions.concat(movedMacroRegions, leftMacroRegions)) {
      const macroName = this._getRegionFlag(region[0], "macroName");
      const macro = game.macros.find(m => m.name === macroName && this._isUserGamemaster(m.data.author));
      if (!macro) {
        continue;
      }

      if (macro.data.type === "chat") {
        this._chatMacroSpeaker = {
          scene: scene._id,
          actor: token.actorId,
          token: token._id,
          alias: token.name,
        };
        ui.chat.processMessage(macro.data.command).catch(err => {
          ui.notifications.error("There was an error in your chat message syntax.");
          console.error(err);
        });
        this._chatMacroSpeaker = null;
      } else if (macro.data.type === "script") {
        const outerToken = token;
        const outerRegion = region;
        {
          const token = canvas.tokens.get(outerToken._id) || new Token(outerToken, scene);
          const actor = token.actor;
          const region = canvas.drawings.get(outerRegion[0]._id) || new Drawing(outerRegion[0], scene);
          const event = outerRegion[1];
          const args = this._getMacroArgs(outerRegion[0]);
          try {
            eval(macro.data.command);
          } catch (err) {
            ui.notifications.error(`There was an error in your macro syntax. See the console (F12) for details`);
            console.error(err);
          }
        }
      }
    }
  }

  _overrideNotesDisplayForToken(scene, token) {
    const actor = game.actors.get(token.actorId);
    if (!actor || !actor.hasPerm(game.user, "OWNER")) {
      return;
    }

    const overrideNotesDisplay = this._getFlaggedRegionsContainingToken(scene, token, "in")
        .some(r => this._hasRegionFlag(r, "activateViaMapNote"));

    const redrawNotes = () => {
      if (canvas.notes._active) {
        canvas.notes.activate();
      } else {
        canvas.notes.deactivate();
      }
    }
    if (overrideNotesDisplay && !game.settings.get("core", NotesLayer.TOGGLE_SETTING)) {
      game.settings.set("core", NotesLayer.TOGGLE_SETTING, true);
      this._overrideNotesDisplay = true;
      redrawNotes();
    } else if (!overrideNotesDisplay && this._overrideNotesDisplay) {
      game.settings.set("core", NotesLayer.TOGGLE_SETTING, false);
      this._overrideNotesDisplay = false;
      redrawNotes();
    }
  }

  _activateTeleport(scene, inRegion, tokens) {
    const outRegions = this._getLinkedRegionsByFlag(scene, inRegion, "teleportId", "out");
    if (!tokens.length || !outRegions.length) {
      return false;
    }

    const destinations = [];
    for (const token of tokens) {
      const [_, outScene, outRegion] = outRegions[Math.floor(outRegions.length * Math.random())];
      let position = this._getTokenPositionFromCentre(outScene, token,
          this._mapPosition(this._getTokenCentre(scene, token), inRegion, outRegion));
      if (this._hasRegionFlag(outRegion, "snapToGrid")) {
        const options = {
          dimensions: Canvas.getDimensions(outScene.data),
          columns: [CONST.GRID_TYPES.HEXODDQ, CONST.GRID_TYPES.HEXEVENQ].includes(outScene.data.gridType),
          even: [CONST.GRID_TYPES.HEXEVENR, CONST.GRID_TYPES.HEXEVENQ].includes(outScene.data.gridType)
        };
        if (outScene.data.gridType === GRID_TYPES.SQUARE) {
          const gridSize = options.dimensions.size;
          position.x = gridSize * Math.round(position.x / gridSize);
          position.y = gridSize * Math.round(position.y / gridSize);
        } else if (outScene.data.gridType === GRID_TYPES.GRIDLESS) {
          position.x = Math.round(position.x);
          position.y = Math.round(position.y);
        } else {
          position = new HexagonalGrid(options).getSnappedPosition(position.x, position.y);
        }
      }
      const animate = this._hasRegionFlag(inRegion, "animate") || this._hasRegionFlag(outRegion, "animate");
      destinations.push([duplicate(token), outScene, animate, position]);
    }
    // TODO: wait for animation to complete before teleporting, if possible? This would avoid visual inconsistencies
    // where a token teleports before completing the move animation into the region.
    this._queueAsync(requestBatch => {
      for (const [token, outScene, animate, position] of destinations) {
        if (outScene === scene) {
          requestBatch.updateToken(scene, {
            _id: token._id,
            x: position.x,
            y: position.y,
          }, animate, /* diff */ false);
          continue;
        }
        const id = token._id;
        delete token._id;
        token.x = position.x;
        token.y = position.y;

        const actor = game.actors.get(token.actorId);
        const owners = actor ? game.users.filter(u => !u.isGM && actor.hasPerm(u, "OWNER")) : [];
        if (!scene.data.tokens.find(t => t._id === id)) {
          // If the token has already gone, don't teleport it. Otherwise we could end up with things like the token getting
          // duplicated multiple times.
          continue;
        }
        requestBatch.deleteToken(scene, id);
        requestBatch.createToken(outScene, token);
        owners.forEach(user => {
          requestBatch.extraAction(() => game.socket.emit("pullToScene", outScene._id, user._id));
        })
      }
    });
  }

  // Teleport one token using any standard teleport regions. Returns true if a teleport occurred, false otherwise.
  _doTeleport(scene, token) {
    if (!this._isPrimaryGamemaster()) {
      return false;
    }

    let inRegions = this._getFlaggedRegionsContainingToken(scene, token, "in")
        .filter(r => !this._hasRegionFlag(r, "activateViaMapNote"));
    inRegions = this._filterRegionsAndUpdateLastTeleport(token, inRegions);
    if (!inRegions.length) {
      return false;
    }

    const inRegion = inRegions[Math.floor(inRegions.length * Math.random())];
    return this._activateTeleport(scene, inRegion, [token]);
  }

  // Activate a map-note triggered teleport region.
  _doMapNoteTeleport(scene, mapNote, user) {
    if (!this._isPrimaryGamemaster()) {
      return false;
    }

    const inRegions = this._getTeleportRegionsForMapNote(scene, mapNote);
    for (let i = inRegions.length - 1; i >= 1; --i) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = inRegions[i];
      inRegions[i] = inRegions[j];
      inRegions[j] = t;
    }

    for (const inRegion of inRegions) {
      const tokens = scene.data.tokens.filter(token => {
        if (!this._isProperToken(token) || !this._isTokenInRegion(scene, token, inRegion)) {
          return false;
        }
        if (user.isGM) {
          return true;
        }
        const actor = game.actors.get(token.actorId);
        return actor && actor.hasPerm(user, "OWNER");
      });
      this._activateTeleport(scene, inRegion, tokens);
    }
  }

  // Teleport between levels within a scene using stair tokens.
  _doLevelTeleport(scene, token) {
    if (!this._isPrimaryGamemaster() || token.name === MLT.TOKEN_STAIRS) {
      return false;
    }

    const levelRegions = this._getFlaggedRegionsContainingToken(scene, token, "level");
    if (!levelRegions.length) {
      return false;
    }

    const allStairTokens = scene.data.tokens.filter(t => t.name === MLT.TOKEN_STAIRS);
    const sourceStairTokens =
        allStairTokens.filter(t => this._isPointInToken(scene, this._getTokenCentre(scene, token), t));
    if (!sourceStairTokens.length) {
      return false;
    }

    const targetStairTokens = [];

    // Iterate over all level regions the token is in. These may overlap, so loop and try each.
    for (const levelRegion of levelRegions) {
      // Get all the level regions that are one below or one above our level (e.g. @level:1 -> @level:0 and @level:2).
      const adjacentLevelRegions = this._getNumericallyAdjacentLevelRegions(scene, levelRegion);
      if (!adjacentLevelRegions.length) {
        continue;
      }

      // Find all matching staircases in the adjacent levels.
      for (const adjacentRegion of adjacentLevelRegions) {
        for (const sourceStairToken of sourceStairTokens) {
          // Check if our token, when moved to the other level's region, would overlap a stair token.
          const targetPosition = this._mapPosition(this._getTokenCentre(scene, sourceStairToken), levelRegion, adjacentRegion);
          const linkedStairToken = allStairTokens.find(t => this._isPointInToken(scene, targetPosition, t));
          if (linkedStairToken) {
            targetStairTokens.push(linkedStairToken);
          }
        }
      }
    }

    if (!targetStairTokens.length) {
      return false;
    }
    const targetStairToken = targetStairTokens[Math.floor(targetStairTokens.length * Math.random())];
    this._queueAsync(requestBatch => requestBatch.updateToken(scene, {
      _id: token._id,
      x: targetStairToken.x,
      y: targetStairToken.y,
    }, /* animate */ false, /* diff */ false));
    return true;
  }

  _legacyTagsToFlags(text) {
    const flags = {
      in: false,
      out: false,
      teleportId: undefined,
      animate: false,
      activateViaMapNote: false,
      snapToGrid: false,
      source: false,
      target: false,
      tintColor: MLT.DEFAULT_TINT_COLOR,
      flipX: false,
      flipY: false,
      macroEnter: false,
      macroLeave: false,
      macroMove: false,
      macroName: undefined,
      macroArgs: undefined,
      level: false,
      levelNumber: 0,
      local: false,
    };
    let converted = false;
    const convertTag = (name, f) => {
      if (text.startsWith(name)) {
        converted = true;
        f(text.substring(name.length));
      }
    }
    const isLocal = id => id.startsWith("!");
    const stripLocal = id => isLocal(id) ? id.substring(1) : id;
    convertTag("@in:", id => {
      flags.in = true;
      flags.local = isLocal(id);
      flags.teleportId = stripLocal(id);
    });
    convertTag("@out:", id => {
      flags.out = true;
      flags.local = isLocal(id);
      flags.teleportId = stripLocal(id);
    });
    convertTag("@inout:", id => {
      flags.in = true;
      flags.out = true;
      flags.local = isLocal(id);
      flags.teleportId = stripLocal(id);
    });
    convertTag("@source:", id => {
      flags.source = true;
      flags.local = isLocal(id);
      flags.cloneId = stripLocal(id);
    });
    convertTag("@target:", id => {
      flags.target = true;
      flags.local = isLocal(id);
      flags.cloneId = stripLocal(id);
    });
    convertTag("@macro:", name => {
      flags.macroEnter = true;
      flags.macroName = name;
    })
    convertTag("@level:", n => {
      flags.level = true;
      flags.levelNumber = parseInt(n);
    });
    return converted ? flags : null;
  }

  _migrateRegion(requestBatch, scene, drawing) {
    if (!this._isAuthorisedRegion(drawing) || !drawing.text) {
      return;
    }
    const flags = this._legacyTagsToFlags(drawing.text)
    if (!flags) {
      return;
    }
    const data = {_id: drawing._id, flags: {}, text: this._flagsToLabel(flags)};
    data.flags[MLT.SCOPE] = flags;
    requestBatch.updateDrawing(scene, data);
  }

  _migrateRegions() {
    this._queueAsync(requestBatch =>
        game.scenes.forEach(scene =>
            scene.data.drawings.forEach(r => this._migrateRegion(requestBatch, scene, r))));
  }

  _flagsToLabel(flags) {
    let lines = [];
    if (flags.disabled) {
      lines.push("🗙");
    }
    if (flags.in || flags.out) {
      lines.push((flags.in ? "▶ " : "") + flags.teleportId + (flags.out ? " ▶" : ""));
    }
    if (flags.source || flags.target) {
      lines.push((flags.source && flags.target ? "🞖" : flags.source ? "🞕" : "◻") + " " + flags.cloneId);
    }
    if (flags.macroEnter || flags.macroLeave || flags.macroMove) {
      lines.push("✧ " + flags.macroName);
    }
    if (flags.level) {
      lines.push("☰ " + String(flags.levelNumber));
    }
    return lines.length ? lines.join(" ") : null;
  }

  _injectDrawingConfigTab(app, html, data) {
    let flags = {};
    if (data.object.flags && data.object.flags[MLT.SCOPE]) {
      flags = data.object.flags[MLT.SCOPE];
    }

    const tab = `<a class="item" data-tab="multilevel-tokens">
      <i class="fas fa-building"></i> ${game.i18n.localize("MLT.TabTitle")}
    </a>`;
    const contents = `
    <div class="tab" data-tab="multilevel-tokens">
      <p class="notes">${game.i18n.localize("MLT.TabNotes")}</p>
      <hr>
      <h3 class="form-header">
        <i class="fas fa-random"/></i> ${game.i18n.localize("MLT.SectionTeleports")}
      </h3>
      <p class="notes">${game.i18n.localize("MLT.SectionTeleportsNotes")}</p>
      <div class="form-group">
        <label for="mltIn">${game.i18n.localize("MLT.FieldIn")}</label>
        <input type="checkbox" name="mltIn" data-dtype="Boolean"/>
      </div>
      <div class="form-group">
        <label for="mltOut">${game.i18n.localize("MLT.FieldOut")}</label>
        <input type="checkbox" name="mltOut" data-dtype="Boolean"/>
      </div>
      <div class="form-group">
        <label for="mltTeleportId">${game.i18n.localize("MLT.FieldTeleportId")}</label>
        <input type="text" name="mltTeleportId" data-dtype="String"/>
      </div>
      <hr>
      <div class="form-group">
        <label for="mltSnapToGrid">${game.i18n.localize("MLT.FieldSnapToGrid")}</label>
        <input type="checkbox" name="mltSnapToGrid" data-dtype="Boolean"/>
        <p class="notes">${game.i18n.localize("MLT.FieldSnapToGridNotes")}</p>
      </div>
      <div class="form-group">
        <label for="mltAnimate">${game.i18n.localize("MLT.FieldAnimateMovement")}</label>
        <input type="checkbox" name="mltAnimate" data-dtype="Boolean"/>
      </div>
      <div class="form-group">
        <label for="mltActivateViaMapNote">${game.i18n.localize("MLT.FieldActivateViaMapNote")}</label>
        <input type="checkbox" name="mltActivateViaMapNote" data-dtype="Boolean"/>
        <p class="notes">${game.i18n.localize("MLT.FieldActivateViaMapNoteNotes")}</p>
      </div>
      <hr>
      <div class="form-group">
        <label for="mltLocal">${game.i18n.localize("MLT.FieldSceneLocal")}</label>
        <input type="checkbox" name="mltLocal" data-dtype="Boolean"/>
        <p class="notes">${game.i18n.localize("MLT.FieldSceneLocalNotes")}</p>
      </div>
      <hr>
      <h3 class="form-header">
        <i class="far fa-clone"/></i> ${game.i18n.localize("MLT.SectionTokenCloning")}
      </h3>
      <p class="notes">${game.i18n.localize("MLT.SectionTokenCloningNotes")}</p>
      <div class="form-group">
        <label for="mltSource">${game.i18n.localize("MLT.FieldSource")}</label>
        <input type="checkbox" name="mltSource" data-dtype="Boolean"/>
      </div>
      <div class="form-group">
        <label for="mltTarget">${game.i18n.localize("MLT.FieldTarget")}</label>
        <input type="checkbox" name="mltTarget" data-dtype="Boolean"/>
      </div>
      <div class="form-group">
        <label for="mltCloneId">${game.i18n.localize("MLT.FieldCloneId")}</label>
        <input type="text" name="mltCloneId" data-dtype="String"/>
      </div>
      <hr>
      <p class="notes">${game.i18n.localize("MLT.SectionTargetRegionNotes")}</p>
      <div class="form-group">
        <label for="mltTintColor">${game.i18n.localize("MLT.FieldClonedTokenTintColor")}</label>
        <div class="form-fields">
          <input class="color" type="text" name="mltTintColor">
          <input type="color" name="mltTintColorPicker" data-edit="mltTintColor">
        </div>
      </div>
      <div class="form-group">
        <label for="mltScale">${game.i18n.localize("MLT.FieldClonedTokenScale")}</label>
        <input type="text" name="mltScale" value="1" data-dtype="Number"/>
      </div>
      <div class="form-group">
        <label for="mltFlipX">${game.i18n.localize("MLT.FieldMirrorHorizontally")}</label>
        <input type="checkbox" name="mltFlipX" data-dtype="Boolean"/>
      </div>
      <div class="form-group">
        <label for="mltFlipY">${game.i18n.localize("MLT.FieldMirrorVertically")}</label>
        <input type="checkbox" name="mltFlipY" data-dtype="Boolean"/>
      </div>
      <hr>
      <h3 class="form-header">
        <i class="fas fa-magic"/></i> ${game.i18n.localize("MLT.SectionMacroTriggers")}
      </h3>
      <p class="notes">${game.i18n.localize("MLT.SectionMacroTriggersNotes")}</p>
      <div class="form-group">
        <label for="mltMacroEnter">${game.i18n.localize("MLT.FieldTriggerOnEnter")}</label>
        <input type="checkbox" name="mltMacroEnter" data-dtype="Boolean"/>
      </div>
      <div class="form-group">
        <label for="mltMacroLeave">${game.i18n.localize("MLT.FieldTriggerOnLeave")}</label>
        <input type="checkbox" name="mltMacroLeave" data-dtype="Boolean"/>
      </div>
      <div class="form-group">
        <label for="mltMacroMove">${game.i18n.localize("MLT.FieldTriggerOnMove")}</label>
        <input type="checkbox" name="mltMacroMove" data-dtype="Boolean"/>
      </div>
      <p class="notes">${game.i18n.localize("MLT.SectionMacroEventsNotes")}</p>
      <div class="form-group">
        <label for="mltMacroName">${game.i18n.localize("MLT.FieldMacroName")}</label>
        <input type="text" name="mltMacroName" data-dtype="String"/>
      </div>
      <div class="form-group">
        <label for="mltMacroName">${game.i18n.localize("MLT.FieldAdditionalArguments")}</label>
        <input type="text" name="mltMacroArgs" data-dtype="String"/>
        <p class="notes">${game.i18n.localize("MLT.FieldAdditionalArgumentsNotes")}</p>
      </div>
      <hr>
      <h3 class="form-header">
        <i class="fas fa-bars"/></i> ${game.i18n.localize("MLT.SectionLevels")}
      </h3>
      <p class="notes">${game.i18n.localize("MLT.SectionLevelsNotes")}</p>
      <div class="form-group">
        <label for="mltLevel">${game.i18n.localize("MLT.FieldLevelRegion")}</label>
        <input type="checkbox" name="mltLevel" data-dtype="Boolean"/>
      </div>
      <div class="form-group">
        <label for="mltLevelNumber">${game.i18n.localize("MLT.FieldLevelNumber")}</label>
        <input type="text" name="mltLevelNumber" value="0" data-dtype="Number"/>
      </div>
      <hr>
      <div class="form-group">
        <label for="mltDisabled">${game.i18n.localize("MLT.FieldDisableRegion")}</label>
        <input type="checkbox" name="mltDisabled" data-dtype="Boolean"/>
        <p class="notes">${game.i18n.localize("MLT.FieldDisableRegionNotes")}</p>
      </div>
    </div>`;

    html.find(".tabs .item").last().after(tab);
    html.find(".tab").last().after(contents);
    const mltTab = html.find(".tab").last();
    const input = (name) => mltTab.find(`input[name="${name}"]`);

    input("mltIn").prop("checked", flags.in);
    input("mltOut").prop("checked", flags.out);
    input("mltTeleportId").prop("value", flags.teleportId);
    input("mltAnimate").prop("checked", flags.animate);
    input("mltActivateViaMapNote").prop("checked", flags.activateViaMapNote);
    input("mltSnapToGrid").prop("checked", "snapToGrid" in flags ? flags.snapToGrid : true);
    input("mltSource").prop("checked", flags.source);
    input("mltTarget").prop("checked", flags.target);
    input("mltCloneId").prop("value", flags.cloneId);
    input("mltTintColor").prop("value", flags.tintColor || MLT.DEFAULT_TINT_COLOR);
    input("mltTintColorPicker").prop("value", flags.tintColor || MLT.DEFAULT_TINT_COLOR);
    input("mltScale").prop("value", flags.scale || 1);
    input("mltFlipX").prop("checked", flags.flipX);
    input("mltFlipY").prop("checked", flags.flipY);
    input("mltMacroEnter").prop("checked", flags.macroEnter);
    input("mltMacroLeave").prop("checked", flags.macroLeave);
    input("mltMacroMove").prop("checked", flags.macroMove);
    input("mltMacroName").prop("value", flags.macroName);
    input("mltMacroArgs").prop("value", flags.macroArgs);
    input("mltLevel").prop("checked", flags.level);
    input("mltLevelNumber").prop("value", flags.levelNumber || 0);
    input("mltLocal").prop("checked", flags.local);
    input("mltDisabled").prop("checked", flags.disabled);

    const isChecked = name => input(name).is(":checked");
    const enable = (name, enabled) => input(name).prop("disabled", !enabled);
    const onChange = () => {
      const isIn = isChecked("mltIn");
      const isOut = isChecked("mltOut");
      const isTeleport = isIn || isOut;
      const isSource = isChecked("mltSource");
      const isTarget = isChecked("mltTarget");
      const isMacro = isChecked("mltMacroEnter") || isChecked("mltMacroLeave") || isChecked("mltMacroMove");
      const isLevel = isChecked("mltLevel");

      enable("mltTeleportId", isTeleport);
      enable("mltAnimate", isTeleport);
      enable("mltActivateViaMapNote", isIn);
      enable("mltSnapToGrid", isOut);
      enable("mltCloneId", isSource || isTarget);
      enable("mltTintColor", isTarget);
      enable("mltTintColorPicker", isTarget);
      enable("mltScale", isTarget);
      enable("mltFlipX", isTarget);
      enable("mltFlipY", isTarget);
      enable("mltMacroName", isMacro);
      enable("mltMacroArgs", isMacro);
      enable("mltLevelNumber", isLevel);
      enable("mltLocal", isTeleport || isSource || isTarget);
    };
    if (this._isUserGamemaster(game.user._id)) {
      mltTab.find("input").on("change", onChange);
    } else {
      mltTab.find("input").prop("disabled", true);
    }
    onChange();
    // TODO: would be nice to have the update button always visible.
  }

  _convertDrawingConfigUpdateData(data, update) {
    if (!("mltIn" in update) && (!update.flags || !update.flags[MLT.SCOPE])) {
      return;
    }

    delete update["mltTintColorPicker"];
    const convertFlag = (inputName, flagName) => {
      if (!(inputName in update)) {
        return;
      }
      if (!data.flags || !data.flags[MLT.SCOPE] || data.flags[MLT.SCOPE][flagName] !== update[inputName]) {
        if (!update.flags) {
          update.flags = {};
        }
        if (!update.flags[MLT.SCOPE]) {
          update.flags[MLT.SCOPE] = {};
        }
        update.flags[MLT.SCOPE][flagName] = update[inputName];
      }
      delete update[inputName];
    };

    convertFlag("mltIn", "in");
    convertFlag("mltOut", "out");
    convertFlag("mltTeleportId", "teleportId");
    convertFlag("mltAnimate", "animate");
    convertFlag("mltActivateViaMapNote", "activateViaMapNote");
    convertFlag("mltSnapToGrid", "snapToGrid");
    convertFlag("mltSource", "source");
    convertFlag("mltTarget", "target");
    convertFlag("mltCloneId", "cloneId");
    convertFlag("mltTintColor", "tintColor");
    convertFlag("mltScale", "scale");
    convertFlag("mltFlipX", "flipX");
    convertFlag("mltFlipY", "flipY");
    convertFlag("mltMacroEnter", "macroEnter");
    convertFlag("mltMacroLeave", "macroLeave");
    convertFlag("mltMacroMove", "macroMove");
    convertFlag("mltMacroName", "macroName");
    convertFlag("mltMacroArgs", "macroArgs");
    convertFlag("mltLevel", "level");
    convertFlag("mltLevelNumber", "levelNumber");
    convertFlag("mltLocal", "local");
    convertFlag("mltDisabled", "disabled");

    let manualText = "text" in update && update.text;
    if (manualText) {
      const convertedFlags = this._legacyTagsToFlags(update.text);
      if (convertedFlags) {
        if (!update.flags) {
          update.flags = {};
        }
        update.flags[MLT.SCOPE] = convertedFlags;
        manualText = false;
      }
    }

    if (!update.flags || !update.flags[MLT.SCOPE]) {
      return;
    }
    const flags = update.flags[MLT.SCOPE];
    const oldFlags = data.flags && data.flags[MLT.SCOPE] ? data.flags[MLT.SCOPE] : {};

    if ("scale" in flags && (isNaN(flags.scale) || flags.scale <= 0)) {
      flags.scale = 1;
    }
    if (flags.in || flags.out || flags.source || flags.target ||
        flags.macroEnter || flags.macroLeave || flags.macroMove || flags.level) {
      update.hidden = true;
    }

    if (!manualText && (this._flagsToLabel(oldFlags) === data.text || !data.text)) {
      const mergedFlags = Object.assign(duplicate(oldFlags), update.flags[MLT.SCOPE]);
      update.text = this._flagsToLabel(mergedFlags);
    }
  }

  _allowTokenOperation(token, options) {
    return !this._isReplicatedToken(token) || (MLT.REPLICATED_UPDATE in options);
  }

  refreshAll() {
    if (!this._isPrimaryGamemaster()) {
      return;
    }
    console.log(MLT.LOG_PREFIX, "Refreshing all");
    this._queueAsync(requestBatch => {
      game.scenes.forEach(scene => {
        scene.data.tokens
            .filter(this._isReplicatedToken.bind(this))
            .forEach(t => requestBatch.deleteToken(scene, t._id));
        scene.data.drawings
            .filter(r => this._hasRegionFlag(r, "source"))
            .forEach(r => this._replicateAllFromSourceRegion(requestBatch, scene, r));
      });
    });
  }

  _onReady() {
    // Replications might be out of sync if there was previously no GM and we just logged in.
    if (this._isOnlyGamemaster()) {
      this._migrateRegions();
      this.refreshAll();
    }
    if (game.user.isGM) {
      this._initializeLastTeleportAndMacroTracking();
      game.socket.on(`module.${MLT.SCOPE}`, this._onSocket.bind(this));
    }
  }

  _onUpdateScene(scene) {
    if (this._isPrimaryGamemaster()) {
      // Workaround for issue where imported scene contains drawings whose author is an invalid user ID.
      // Can assume a GM took the import action and update to use their ID instead.
      this._queueAsync(requestBatch => {
        scene.data.drawings.filter(d => !game.users.find(u => u.id === d.author)).forEach(d => {
          requestBatch.updateDrawing(scene, {
            _id: d._id,
            author: game.user.id,
          });
        });
      });
    }
    this.refreshAll();
    return true;
  }

  _onCreateDrawing(scene, drawing, options, userId) {
    if (this._hasRegionFlag(drawing, "source")) {
      const d = duplicate(drawing);
      this._queueAsync(requestBatch => this._replicateAllFromSourceRegion(requestBatch, scene, d));
    }
    if (this._hasRegionFlag(drawing, "target")) {
      const d = duplicate(drawing);
      this._queueAsync(requestBatch => this._replicateAllToTargetRegion(requestBatch, scene, d));
    }
  }

  _onPreUpdateDrawing(scene, drawing, update, options, userId) {
    this._convertDrawingConfigUpdateData(drawing, update);
    if (update.flags && update.flags[MLT.SCOPE]) {
      this._onDeleteDrawing(scene, drawing, update, options, userId);
    }
    return true;
  }

  _onUpdateDrawing(scene, drawing, update, options, userId) {
    if (update.flags && update.flags[MLT.SCOPE]) {
      this._onCreateDrawing(scene, drawing, options, userId);
    } else if (this._hasRegionFlag(drawing, "source") || this._hasRegionFlag(drawing, "target")) {
      const d = duplicate(drawing);
      this._queueAsync(requestBatch => {
        if (this._hasRegionFlag(d, "source")) {
          this._updateAllReplicatedTokensForSourceRegion(requestBatch, scene, d);
        }
        if (this._hasRegionFlag(d, "target")) {
          this._updateAllReplicatedTokensForTargetRegion(requestBatch, scene, d);
        }
      });
    }
  }

  _onDeleteDrawing(scene, drawing, options, userId) {
    if (this._hasRegionFlag(drawing, ["source", "target"])) {
      const d = duplicate(drawing);
      this._queueAsync(requestBatch => this._removeReplicationsForRegion(requestBatch, scene, d));
    }
  }

  _onPreCreateToken(scene, token, options, userId) {
    return this._allowTokenOperation(token, options);
  }

  _onCreateToken(scene, token, options, userId) {
    if (this._isProperToken(token)) {
      const t = duplicate(token);
      this._queueAsync(requestBatch => this._replicateTokenToAllRegions(requestBatch, scene, t));
      this._setLastTeleport(scene, token);
    }
  }

  _onPreUpdateToken(scene, token, update, options, userId) {
    if (this._allowTokenOperation(token, options) || this._isInvalidReplicatedToken(scene, token)) {
      return true;
    }
    // Attempt to update replicated token.
    if ('x' in update || 'y' in update || 'rotation' in update || 'actorId' in update) {
      return false;
    }
    const sourceScene = this._getSourceSceneForReplicatedToken(scene, token);
    const sourceToken = this._getSourceTokenForReplicatedToken(scene, token);
    if (sourceScene && sourceToken) {
      const newUpdate = duplicate(update);
      newUpdate._id = sourceToken._id;
      sourceScene.updateEmbeddedEntity(Token.embeddedName, newUpdate, options);
    }
    return false;
  }

  _onUpdateToken(scene, token, update, options, userId) {
    if (MLT.REPLICATED_UPDATE in options && "animate" in options && !options.animate &&
        ('x' in update || 'y' in update)) {
      // Workaround for issues with a non-animated position update on a token that is already animating.
      const canvasToken = canvas.tokens.placeables.find(t => t.id === token._id);
      if (canvasToken && canvasToken._movement) {
        canvasToken._movement = null;
        canvasToken.stopAnimation();
        canvasToken._onUpdate({x: token.x, y: token.y}, {animate: false});
        canvas.triggerPendingOperations();
      }
      // Workaround for vision bug on 0.7.4.
      if (canvasToken && canvasToken.updateSource) {
        canvasToken.updateSource();
      }
    }
    if (!game.user.isGM) {
      this._overrideNotesDisplayForToken(scene, token);
    }
    if (this._isProperToken(token)) {
      const t = duplicate(token);
      this._queueAsync(requestBatch => this._updateAllReplicatedTokensForToken(requestBatch, scene, t, Object.keys(update)));
      if ('x' in update || 'y' in update) {
        this._doMacros(scene, token);
      }
      if (MLT.REPLICATED_UPDATE in options) {
        this._setLastTeleport(scene, token);
      } else {
        this._doTeleport(scene, token) || this._doLevelTeleport(scene, token);
      }
    }
  }

  _onControlToken(token, control) {
    if (!game.user.isGM) {
      this._overrideNotesDisplayForToken(token.scene, token.data);
    }
  }

  _onPreDeleteToken(scene, token, options, userId) {
    return this._allowTokenOperation(token, options) || this._isInvalidReplicatedToken(scene, token);
  }

  _onDeleteToken(scene, token, options, userId) {
    if (this._isProperToken(token)) {
      const t = duplicate(token);
      this._queueAsync(requestBatch => this._removeReplicationsForSourceToken(requestBatch, scene, t));
      delete this._lastTeleport[token._id];
      delete this._lastMacro[token._id];
    }
  }

  _onTargetToken(user, token, targeted) {
    // Auto-targetting handled on user's client, since targetting is scene-local.
    if (user !== game.user || !game.settings.get(MLT.SCOPE, MLT.SETTING_AUTO_TARGET)) {
      return;
    }
    this._getAllLinkedCanvasTokens(token.data).forEach(t => {
      if (t !== token && targeted !== user.targets.has(t)) {
        t.setTarget(targeted, {releaseOthers: false, groupSelection: true});
      }
    });
  }

  _onHoverNote(note, hover) {
    if (!hover || !this._getTeleportRegionsForMapNote(note.scene, note.data).length) {
      return;
    }
    if (!note.mouseInteractionManager.mltOverride) {
      note.mouseInteractionManager.mltOverride = true;

      const oldPermission = note.mouseInteractionManager.permissions.clickLeft;
      const oldCallback = note.mouseInteractionManager.callbacks.clickLeft;
      note.mouseInteractionManager.permissions.clickLeft = () => true;
      note.mouseInteractionManager.callbacks.clickLeft = (event) => {
        if (this._isPrimaryGamemaster()) {
          this._doMapNoteTeleport(note.scene, note.data, game.user);
        } else {
          game.socket.emit(`module.${MLT.SCOPE}`, {
            operation: "clickMapNote",
            user: game.user.id,
            scene: note.scene.id,
            note: note.id,
          });
        }
        if (oldPermission.call(note, game.user)) {
          oldCallback.call(note, event);
        }
      };
    }
  }

  _onPreCreateCombatant(combat, combatant, options, userId) {
    const token = combat.scene.data.tokens.find(t => t._id === combatant.tokenId);
    if (!token || !this._isReplicatedToken(token)) {
      return true;
    }
    const sourceScene = this._getSourceSceneForReplicatedToken(combat.scene, token);
    if (sourceScene !== combat.scene) {
      return true;
    }
    const sourceToken = this._getSourceTokenForReplicatedToken(combat.scene, token);
    if (sourceToken) {
      const activeCombatant = combat.getCombatantByToken(sourceToken._id);
      if (activeCombatant) {
        combat.deleteEmbeddedEntity("Combatant", activeCombatant._id);
      } else {
        combat.createEmbeddedEntity("Combatant", { tokenId: sourceToken._id, hidden: sourceToken.hidden});
      }
    }
    return false;
  }

  _onChatMessage(chatLog, message, chatData) {
    if (this._chatMacroSpeaker) {
      chatData.speaker = this._chatMacroSpeaker;
      this._chatMacroSpeaker = null;
    }
    return true;
  }

  _onCreateChatMessage(message, options, userId) {
    if (!options.chatBubble || !canvas.ready || !game.settings.get(MLT.SCOPE, MLT.SETTING_AUTO_CHAT_BUBBLE)) {
      return;
    }
    const scene = game.scenes.get(message.data.speaker.scene);
    if (!scene) {
      return;
    }
    const token = scene.data.tokens.find(t => t._id === message.data.speaker.token);
    if (!token) {
      return;
    }
    this._getAllLinkedCanvasTokens(token).forEach(t => {
      if (t.scene !== scene || t.data._id !== token._id) {
        canvas.hud.bubbles.say(t, message.data.content, {emote: message.data.type === CONST.CHAT_MESSAGE_TYPES_EMOTE});
      }
    })
  }

  _onRenderDrawingConfig(app, html, data) {
    if (this._isAuthorisedRegion(data.object)) {
      this._injectDrawingConfigTab(app, html, data);
    }
  }

  _onSocket(data) {
    if (!this._isPrimaryGamemaster()) {
      return;
    }
    if (data.operation === "clickMapNote") {
      const scene = game.scenes.get(data.scene);
      const user = game.users.get(data.user);
      if (!scene || !user) {
        return;
      }
      const note = scene.data.notes.find(note => note._id === data.note);
      if (note) {
        this._doMapNoteTeleport(scene, note, user);
      }
    }
  }
}

console.log(MLT.LOG_PREFIX, "Loaded");
Hooks.on('init', () => game.multilevel = new MultilevelTokens());
