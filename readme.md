# lichess-puzzles

This is a Crosspoint reader plugin that fetches the lichess.org daily puzzle
and leaves it showing on the lock/sleep screen. The board occupies most of
the space so pieces are easy to distinguish. The diagrams are styled after
classic newspaper Chess puzzles.

Made for the XTEINK X4 Pro reader with 480x800 pixel screen resolution.

Puzzle API URLs:

- Daily puzzle: https://lichess.org/api/puzzle/daily
- Puzzle pack (batch): https://lichess.org/api/puzzle/batch/mix?nb=N (N = 1–50)

Crosspoint plugins documentation:
https://github.com/crosspoint-reader/crosspoint-reader/blob/develop/docs/sd-plugins.md

## Install

Install it from Plugin Hub (Community Plugins), or sideload it: the files in
`lichess-puzzles.crosspoint-plugin/` are the plugin, with no build step. Copy
them to `/plugins/lichess-puzzles/` on the SD card, or create that folder in
the reader's web file manager and upload the files into it.

## Publishing (Plugin Hub)

The repository follows the Plugin Hub contract
(https://github.com/crosspoint-reader/crosspoint-plugin-hub/blob/main/PLUGIN_HUB_CONTRACT.md):
one payload folder named `<name>.crosspoint-plugin/` whose stem matches
`manifest.json` -> `name`, and an explicit `files` list. To release:

1. Bump `version` in the manifest (`MAJOR.MINOR.PATCH`).
2. Commit, then publish a non-draft, non-prerelease GitHub Release tagged
   `v<version>`.

The repository must be public and carry the `crosspoint-plugin` topic. Plugin
Hub's catalog refresh (every 3 hours) picks the release up; no pull request is
needed. Never reuse a tag: every runtime change needs a new version.



## How it works

CrossPoint cannot run plugin code on the reader itself, so `plugin.js` runs in
the browser (the device's Plugins page, or `/plugins-run`). It starts in
puzzle pack mode (below) and writes nothing until the user acts. In **daily
mode** it fetches the daily puzzle through the device's `/api/relay`, draws a 480x800 newspaper-style
diagram on a canvas, and writes it to `/sleep.bmp` as a 1-bit BMP. The
reader's **Custom** sleep screen shows `/sleep.bmp` first. The image is
refreshed whenever the page is open and lichess has a new puzzle, or on demand
through the job queue (`{"plugin":"lichess-puzzles","action":"update"}`).
Daily mode never overwrites a `/sleep.bmp` it did not write (checked by size
and a fingerprint of its contents); the card says so and offers an explicit
Replace button.

**Puzzle pack mode** fetches 1–50 puzzles (the most lichess sends in one batch) from
`https://lichess.org/api/puzzle/batch/mix?nb=N` (downloaded to the SD card
with `fetchToSd`, since a full batch can exceed the relay's body cap) and
writes `/sleep/lichess-puzzle-NN.bmp`. With no `/sleep.bmp`, the Custom sleep
screen shows a different one on every sleep, cycling through all of them, so
the user only needs to connect once per pack. The firmware cannot choose a
sleep image by date, so a pack is per sleep, not per day. Batch puzzles carry
no FEN, so the position is found by replaying the game's moves up to
`initialPly`. The plugin never deletes `/sleep.bmp`; a button removes the
`lichess-puzzle-*.bmp` files.

## Development

- `node test/test.js` — notation and BMP encoder checks.
- Open `test/preview.html` in a browser to see sample puzzles exactly as they
  are written to the reader.
