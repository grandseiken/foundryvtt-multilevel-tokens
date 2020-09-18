# Multilevel Tokens module for Foundry VTT

This module for FoundryVTT adds features to help support multi-level or multi-floor maps, particularly those where each floor is a separate scene or a separate part of the map.

After marking out _source_ and _target_ regions, any tokens present in each source region will be automatically cloned to the corresponding target region. Cloned tokens will be kept up-to-date with the original tokens, mirroring their relative movement and other updates to the originals.

![Demo animation](demo/0.gif)

For example, if a source region is a part of a lower floor, and its target region is the corresponding empty space on the upper floor beside a balcony of some sort, players can "see" what's happening on the floor below.

You could probably also use this functionality for other interesting things, like crystal balls, or who knows.

This module also has a few other bonus features:
* since multi-level maps often need a way to travel between the floors, simple teleports can be set up using a similar region-based mechanism.
* you can also create regions that will execute a macro when a token enters.

# Installation

You can install this module using the following public URL: `https://raw.githubusercontent.com/grandseiken/foundryvtt-multilevel-tokens/master/module.json`

Remember to enable the module in `Manage Modules` menu after installation.

# Usage guide

## Creating cloned regions

1. Use the rectangle, ellipse or polygon drawing tool to create your source and target regions. You probably want to set them to hidden so that your players can't see them.
2. Set the text labels on the drawings (accessible via double right-click menu) to _exactly_ `@source:XXX` and `@target:XXX`, respectively, where `XXX` is some common identifier.
3. That's it! Tokens in the source region will be mirrored in target regions with the matching identifier.

### Notes

* You can have more than one target region with the same identifier: tokens in the source region(s) get mirrored to all of them.
* You can have more than one source region with the same identifier: tokens from all of them get mirrored to the targets.
* Source and target regions can be on the same scene or different.
* You can use the polygon tool to make region with more complicated shapes. You can move and rotate them freely without messing anything up.
* If the source and target regions are different sizes, the mirrored copies will get scaled up or down to fit. You probably want the aspect ratios to match though. It's best to start by making two copies of the same drawing.

![Example image](demo/1.gif)

* If you want bidirectional syncing of tokens, you need to create two pairs of linked regions with different identifiers (both a source and a target in each place).
* Cloned tokens can't be moved or deleted independently. They don't have a linked actor, aren't controlled by a player, and don't have vision. They have an extra tint applied to make them easily distinguishable, which can be changed in the `Module Settings` menu. They inherit most other properties (hidden, size, name, disposition, etc) from the original token.
* By default, when a player targets or detargets a token, they will also target or detarget any clones or originals of that token. You can turn this off in the `Module Settings` menu if it interferes with anything. Similarly, adding a cloned token to combat will add the original copy to combat instead, as long as it's on the same scene.
* Chat bubbles (if enabled) will be shown on each copy of a token. This can be turned off in the `Module Settings` menu.

## Creating teleport regions

Teleports work with marked regions just like the cloning system. The only difference is you need to label drawings with `@in:XXX` for a teleport starting area, `@out:XXX` for a destination area, or `@inout:XXX` for a two-way area.

Any token that moves into an `@in` or `@inout` region will be moved to the corresponding `@out` or `@inout` region. If there's more than one such destination region, one will be chosen randomly. The destination can be on a different scene. Non-GM owners of the token will get pulled to the new scene if the token teleports to a different one.

![Example animation](demo/2.gif)

In the `Module Settings` menu you can choose whether a teleport to the same scene will animate the token or move it instantly to the destination.

## Creating level-based teleports

_Level_ regions provide an alternative way to set up teleports, rather than using `@in` / `@out` / `@inout` regions. This method is a little bit less flexible and does not support cross-scene teleporting, but can be faster and more convenient to set up in some cases. It works well for large maps with many small pairs of teleportation points (e.g. staircases or ladders) between adjacent floors of a building.

* First, create regions marking out the different levels of your structure and label each one with the text `@level:N`, where `N` is the level number.
* Mark each stairway entrance / exit on each level with a token with the name `@stairs`. You can set up an actor for this purpose. You probably want to make them invisible.
* When a token moves on top of a `@stairs` token, it will be teleported to any corresponding `@stairs` token at the same relative position one level above or below, if one exists.

![Example animation](demo/3.gif)

Note that careful placement of these regions and tokens is necessary in order to link stairs together: tokens will teleport only between stairs that have identical relative positions within numerically-adjacent `@level` regions. It's therefore recommended to make the `@level` regions exactly the same size and enable snap-to-grid.

You can use both methods of teleportation in combination. Movement by `@in` and `@inout` regions takes priority over movement by `@stairs` tokens and `@level` regions, should the regions overlap.

## Macro regions

You can run a specific macro whenever a token enters a particular area using _macro_ regions. These work similarly to other region types, but need to be labelled with the text `@macro:NAME`, where `NAME` is the name of a macro you've created. The macro must have been created by a GM user.

* Chat macros will be spoken as if by whichever token entered the region.
* Script macros will be executed by the GM whenever a token enters the region. The macro command can make use of the following variables:
  * `scene`: the `Scene` object containing the token and region.
  * `region`: a `Drawing` object describing the region which was entered.
  * `token`: a `Token` object for the token which entered the region.

  Note that script macros triggered in this way run on the GM's client, and the GM might not currently be viewing the scene in question. In this case, the `Drawing` and `Token` objects described above will be temporary objects created purely for the macro's execution, rather than the currently-visible ones found in `canvas.tokens` and `canvas.drawings`.

## Advanced options

* Region identifiers that start with `!` are _scene-local_: they will only match with other regions on the same scene. For example, a region with the label `@in:!bar` will only teleport to a region labelled `@out:!bar` on the same scene, even if another scene also has a region labelled `@out:!bar`. The same behaviour applies to cloned regions. This might be useful if you don't need cross-scene linking, and don't want to worry about making sure you use different identifiers on each scene. Or if you're going to duplicate a scene a whole bunch.

## Troubleshooting

* Drawings need to have been _created_ by a user with the `GAMEMASTER` role in order to function as linked regions.
* For small regions, you may need to reduce the label font size to allow resizing the drawing. Or, you can add the label after the size is right.
* The module needs a Gamemaster logged in to function properly, since it works by tracking changes on the GM's client and issuing commands with GM permissions in the background to manipulate tokens. If tokens get out of sync because of this, you can use the snippet `game.multilevel.refreshAll()` (e.g. from a script macro) to wipe and recreate all cloned tokens.
* Note the above point means performance impact should be low, because all the complicated logic runs only on the GM's client. Other clients only have to deal with the resulting automated token updates.
* The module will detect if more than one GM user is logged in, and only run on one of their clients. However, it can't currently detect if a _single_ GM user is logged in via multiple browser sessions, and problems may arise in that case due to the logic executing multiple times.
* Note that, by necessity, cloned tokens are not associated with any actor, and this can sometimes cause compatibility issues with other macros or modules. Foundry allows a token to have no actor, but, since this is an unusual case, it's often not accounted for. Most commonly, this can result in the macro or module throwing an error like `TypeError: Cannot read property 'data' of null`.
* If something still isn't working you can file an issue here or reach me at `grand#5298` on the discord.

# Version history

* **1.0.0**:
  * Overhauled the user interface to make the module easier to use. Regions are now configured using a dedicated interface within a tab in the Drawing Configuration window for any applicable drawing. It's no longer necessary to add text labels containing special syntax to each drawing.
  * Short descriptive labels are still added (automatically) to each region for clarity, but have no special meaning. They can be overridden by editing the label text manually.
  * Regions set up using the old mechanism will be automatically updated to the new format.
  * A single drawing may now serve multiple purposes at once. For example, a region can be both a teleport and a macro trigger, or both a clone source and a clone target.
  * Removed the global module setting for tinting cloned tokens. This can now be configured individually for each clone target region.
  * Removed the global module setting for animating token movement when teleporting. This can now be enabled or disabled individually for each teleport region.
  * Clone target regions can now be configured to mirror token positions horizontally or vertically.
  * Macro regions now support passing a fixed set of additional arguments to the macro when triggered, available in the new `args` variable.
  * Macro regions now support also triggering the macro when a token leaves the region, or whenever a token moves within it. Each of the triggers can be enabled or disabled for a region individually. A new `event` variable available to the macro describes which type of event occurred.
  * Fixed a floating-point accuracy issue that led to level regions and `@stairs` tokens sometimes not functioning.
* **0.4.0**:
  * Added another way to set up teleports using `@level` regions (contributed by [TheGiddyLimit](https://github.com/TheGiddyLimit)).
  * Added a way to trigger macros using `@macro` regions.
  * Added a module setting to copy flags set by other modules when cloning tokens, to aid compatibility, default on.
  * Fixed an issue that could result in tokens being duplicated when teleporting between scenes.
  * Fixed that marked regions would not function when imported as part of scene data using Foundry's scene import / export feature.
* **0.3.0**:
  * Added a module setting to animate token movement when teleporting to the scene same, default off.
  * Added a module setting to also show chat bubbles on each copy of a token, default on.
  * Added a module setting to synchronize player targeting between original and cloned tokens, default on.
  * Toggling the combat state of a cloned token will now toggle the combat state of its original instead, if on the same scene.
  * Editing a cloned token via the token HUD or configuration menu will now apply the changes to the original token, rather than silently discarding the update.
  * Region identifiers that start with `!` are now scene-local and won't match with regions on other scenes.
  * Fixed compatibility issue with missing actor ID on cloned tokens, affecting at least the Token Mold module.
  * Fixed that tokens deleted by the module weren't removed from combat.
* **0.2.0**:
  * Added support for ellipse and polygon regions.
  * Rotation of drawings is now taken into account.
  * Cloned regions now update when a scene is created or deleted.
  * Fixed incorrect behaviour that could occur when a scene was duplicated.
  * Fixed that a cloned token could be copy-pasted, resulting in a temporary stuck token.
  * Fixed an error that could occur when a rectangle had no `text` property.
* **0.1.0**:
  * First version.
