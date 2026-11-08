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

## Build

Run ./build.sh and the .zip plugin package is left in
`out/lichess_puzzles.zip`.



## How it works

CrossPoint cannot run plugin code on the reader itself, so `plugin.js` runs in
the browser (the device's Plugins page, or `/plugins-run`). It fetches the
daily puzzle through the device's `/api/relay`, draws a 480x800 newspaper-style
diagram on a canvas, and writes it to `/sleep.bmp` as a 1-bit BMP. The
reader's **Custom** sleep screen shows `/sleep.bmp` first. The image is
refreshed whenever the page is open and lichess has a new puzzle, or on demand
through the job queue (`{"plugin":"lichess_puzzles","action":"update"}`).

## Development

- `node test/test.js` — notation and BMP encoder checks.
- Open `test/preview.html` in a browser to see sample puzzles exactly as they
  are written to the reader.
