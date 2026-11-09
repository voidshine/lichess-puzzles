# lichess puzzles

This is a Crosspoint reader plugin that fetches the lichess.org daily puzzle
and leaves it showing on the lock/sleep screen. The board occupies most of
the space so pieces are easy to distinguish. The diagrams are styled after
classic newspaper Chess puzzles.

Made for the XTEINK X4 Pro reader with 480x800 pixel screen resolution.

Puzzle API URL:
https://lichess.org/api/puzzle/daily

Crosspoint plugins documentation:
https://github.com/crosspoint-reader/crosspoint-reader/blob/develop/docs/sd-plugins.md

## Install

The `lichess_puzzles/` folder is the plugin; there is no build step. Copy it
to `/plugins/` on the SD card (so the files end up in
`/plugins/lichess_puzzles/`), or create that folder in the reader's web file
manager and upload `manifest.json`, `plugin.js` and `README.md` into it.



## How it works

CrossPoint cannot run plugin code on the reader itself, so `plugin.js` runs in
the browser (the device's Plugins page, or `/plugins-run`). It fetches the
daily puzzle through the device's `/api/relay`, draws a 480x800 newspaper-style
diagram on a canvas, and writes it to `/sleep.bmp` as a 1-bit BMP. The
reader's **Custom** sleep screen shows `/sleep.bmp` first. The image is
refreshed whenever the page is open and lichess has a new puzzle, or on demand
through the job queue (`{"plugin":"lichess_puzzles","action":"update"}`).

**Puzzle pack mode** fetches 1–50 puzzles (the most lichess sends in one batch) from
`https://lichess.org/api/puzzle/batch/mix?nb=N` and
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
