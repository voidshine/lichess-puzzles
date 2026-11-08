lichess daily puzzle

Shows the lichess.org daily chess puzzle on the sleep screen, drawn like a
classic newspaper diagram: hatched dark squares, woodcut-style pieces, and the
solution printed upside down at the bottom.

SETUP

1. Settings > Connectivity > Plugins: Enabled.
2. Settings > Display > Sleep Screen: Custom. (The plugin's web card offers a
   button that does this for you.)
3. Start File Transfer and open the reader's web page in a browser, then go to
   Plugins. The card fetches today's puzzle and writes it to /sleep.bmp.

The next time the reader sleeps, the puzzle is on screen.

KEEPING IT FRESH

The reader cannot draw the puzzle by itself, so the image is made in the
browser. Each time the Plugins page (or /plugins-run) is open, the plugin
checks lichess for a new daily puzzle and replaces /sleep.bmp when there is
one. Companion apps can trigger it through the job queue:

  POST /api/plugin-jobs
  {"plugin":"lichess_puzzles","action":"update"}

with /plugins-run open. Add "args":{"force":true} to redraw even when the
puzzle has not changed.

OPTIONS (on the web card)

- Print the solution upside down at the bottom (default on)
- Show puzzle themes as a hint (default on)
- Show board coordinates (default on)

NOTES

- /sleep.bmp takes priority over the /sleep folder. If a /sleep.bmp that this
  plugin did not create is already on the card, the plugin asks before
  replacing it.
- The board is shown from the side to move, as on lichess.
