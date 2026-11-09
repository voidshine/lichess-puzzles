# lichess puzzles

Puts lichess.org chess puzzles on the sleep screen, drawn like a classic newspaper diagram: hatched dark squares, woodcut-style pieces, the side to move, and the solution printed upside down at the bottom.

## Two modes

- **Puzzle pack (default):** 1 to 50 puzzles in /sleep/lichess-puzzle-01.bmp and up. The reader shows a different one each time it sleeps, so one visit lasts the whole pack.
- **Daily puzzle:** today's lichess puzzle in /sleep.bmp, refreshed whenever the Plugins page is open in a browser. Off until you choose it, and it asks before replacing a /sleep.bmp it did not create.

## Setup

- Set Settings > Display > Sleep Screen to Custom (the plugin's web card can do it for you).
- Start File Transfer in Join Network mode, open the reader's web page and go to Plugins.

The images are drawn in the browser, because the reader cannot run plugin code. The plugin never deletes /sleep.bmp or your own images; a button removes its puzzle files.
