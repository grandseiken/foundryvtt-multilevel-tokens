# Multilevel Tokens module for Foundry VTT

This module for FoundryVTT adds features to help support multi-level or multi-floor maps, particularly those where each floor is a separate scene or a separate part of the map.

After marking out _source_ and _target_ regions, any tokens present in each source region will be automatically cloned to the corresponding target region. Cloned tokens will be kept up-to-date with the original tokens, mirroring their relative movement and other updates to the originals.

![Demo animation](demo/0.gif)

For example, a source region is a part of a lower floor, and its target region is the corresponding empty space on the upper floor beside a balcony of some sort, players can "see" what's happening on floors below, since the target region acts as a view into the floor beneath.

You could probably also use this functionality for other interesting things, like crystal balls, minimaps, or whatever else.

# Installation

You can install this module using the following public URL: `https://raw.githubusercontent.com/grandseiken/foundryvtt-multilevel-tokens/master/module.json`

Remember to enable the module in `Manage Modules` menu after installation.

# Usage guide

## Creating linked regions

1. Use the rectangle drawing tool to create your source and target regions. You probably want to set them to hidden so that your players can't see them.
2. Set the text labels on the regions (accessible via double right-click menu) to _exactly_ `@source:XXX` and `@target:XXX`, respectively, where `XXX` is some common identifier.
3. That's it! Tokens in the source region will be mirrored in target regions with the matching identifier.

## Notes

* You can have more than one target region with the same identifier: tokens in the source region(s) get mirrored to all of them.
* You can have more than one source region with the same identifier: tokens from all of them get mirrored to the targets.
* Source and target regions can be on the same scene or different.
* If the source and target regions are different sizes, the mirrored copies will get scaled up or down to fit. You probably want the aspect ratios to match though.

![Example image](demo/1.gif)

* If you want bidirectional syncing of tokens, you need to create two pairs of linked regions with different identifiers (both a source and a target in each place).
* Cloned tokens can't be moved or deleted independently. They don't have a linked actor, aren't controlled by a player, and don't have vision. They have an extra tint applied to make them easily distinguishable, which can be changed in the `Module Settings` menu. They inherit most other properties (hidden, size, name, disposition, etc) from the original token.

## Troubleshooting

* Only rectangle drawings can be made into linked regions, and their rotation value is
ignored. They also need to have been _created_ by a user with the `GAMEMASTER` role in order to function as linked regions.
* The module needs a Gamemaster logged in to function properly, since it works by tracking changes on the GM's client and issuing commands with GM permissions in the background to manipulate tokens. If tokens get out of sync because of this, you can use the snippet `game.multilevel.refreshAll()` (e.g. from a script macro) to wipe and recreate all cloned tokens.
