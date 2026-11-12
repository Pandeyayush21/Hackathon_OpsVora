# Arrow Escape

A puzzle game: every arrow slides the way it points. Tap an arrow whose path is clear and it leaves the board. Tap one that's blocked and it bounces back and costs a life. Clear the board.

Plain HTML, CSS and JavaScript. No build step and no dependencies.

## Play locally

```bash
cd games/arrow-escape
npm start            # serves on http://localhost:8080
```

Opening `index.html` directly also works, but install-as-app and offline play need a web server.

## What's in it

**10 worlds, one new piece each**

| World | Piece | Rule |
|---|---|---|
| 1 First Steps | – | Learn the basics (level 1 is a guided tutorial) |
| 2 Stonefield | Stones | Never move, block every arrow |
| 3 Lock & Key | Locks | A locked arrow waits until its key arrow has left |
| 4 Two-Way Street | Two-headed arrows | Leave from either end; tap the end you want |
| 5 Switchbacks | Turn tiles | Bend sliding arrows by 90° |
| 6 Wormholes | Portals | Enter one, come out of its twin |
| 7 Colour Gates | Gates | Only arrows of the same colour pass |
| 8 Short Fuse | Fuse arrows | Clear before the countdown hits zero |
| 9 Chained | Linked arrows | Leave together; both paths must be clear |
| 10 Endless | Everything | Mixed pieces, levels never end |

The 10th level of each world is a bigger boss board. From the middle of each world on, an earlier piece is mixed in.

**Modes:** Levels, Daily Puzzle (same board for everyone each day, shareable result), Zen (no lives, unlimited undo), Time Attack (2 minutes), Surge (arrows keep arriving), Duel (two players on one phone: take 1 or 2 arrows a turn, a bump loses, last arrow wins).

**Scoring:** moves against par, a combo multiplier for quick clears, stars (3 = no bumps), Perfect Clear for no bumps and no undo. Stars unlock 5 arrow styles.

**Other:** undo, hints, pinch/scroll zoom with a mini-map on big boards, sound, vibration, sparks and screen shake (each can be turned off), colour-blind symbols, light and dark themes, installable as an app with offline play.

## How levels are made

`engine.js` builds each level from a fixed seed, so level 37 is the same board for everyone. Arrows are placed one at a time, and each new arrow's exit path must be clear of every arrow already placed. Later arrows can block earlier ones (that is the puzzle) but never the other way round, so every board can be solved. Locks and chains are only kept when a solver confirms the board still clears. Fuse counts come from a plan that clears the fuse arrows first, plus 1 or 2 spare moves.

Removing an arrow never makes another arrow harder to move. So a greedy solver ("clear anything that's free, repeat") is exact, and the tests use it to check every level.

Each level is picked from several generated candidates. The pick favours long dependency chains, few free arrows at the start, and long, winding arrows.

## Tests

```bash
npm test
```

Checks that the tutorial and levels 2 to 150 are solvable, that each world contains its piece, and that fuse counts can be met. Also checks daily, zen, time attack and duel boards, keeps Surge solvable while arrows spawn and leave, and covers turn-tile, portal and gate rules.

## Files

- `index.html`: interface, rendering, input, modes and saved progress
- `engine.js`: rules, level generator and solver (no DOM; also runs in Node)
- `tests/engine.test.js`: engine tests
- `manifest.webmanifest`, `sw.js`, `icon.svg`: install-as-app and offline support
- `scripts/build-artifact.py`: strips the page wrapper and app files for the hosted preview
