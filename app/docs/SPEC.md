# Sudoku Battles: test version spec

Hugo's answers from 2026-11-09 are the source. Every number here is the value in the code
(`server/match.js` `RULES`, `server/glicko2.js`, `server/app.js`). Change both together.

## Product

Like chess.com, for sudoku: simple, fast, no ads. Live 1v1 speed races, a rating ladder,
friends, custom rules for friend games. Extras come later.

| Who | Can do |
|---|---|
| Guest (no login) | Solo sudoku. 1v1 with a friend by link or code. No stats, no rating. |
| Account | Everything a guest can, plus ranked vs strangers, ratings, stats, friends, challenges. |

## The race

- Both players get the **same puzzle** at the same moment, after a 3-second countdown that
  starts once both are connected.
- **Fastest correct solve wins.** No points. Time is measured by the server, from "go" to the
  last correct digit.
- Each player sees the opponent's **progress** (cells filled out of cells to fill), their
  **mistakes**, and whether they are connected. Never the opponent's board.
- Every digit is **checked right away**. A right digit is locked in. A wrong digit is not
  placed and counts as a mistake.
- **Mistake limit:** ranked is 3. Friend games choose 1, 3 or 5. Reaching the limit puts you
  out, and the opponent wins.
- **Notes** are allowed and stay on your device.
- **Erase** only clears notes, because confirmed digits are always right.

### When the result is decided

| Event | Result |
|---|---|
| A player fills the grid | They win (`solved`) |
| A player reaches the mistake limit | The other wins (`mistakes`) |
| A player gives up | The other wins (`resign`) |
| A player is disconnected for 30 s | The other wins (`disconnect`) |
| Time cap reached (medium 40 min, hard 60, extreme 90) | More cells filled wins; equal is a draw (`timeout`) |

After the result, a player who is still on the board gets a prompt: **Keep going** (finish
for their own time, which does not change the result) or **Stop**. The game closes when both
are done.

### No result (aborted, no rating change)

- A player never connects within 20 s (`no-show`).
- A player presses Abort within the first 20 s, before trying any cell.
- A player disconnects within the first 20 s, before trying any cell, and does not come back
  within 30 s (`left-early`).

### Limits

- At most 15 moves per second per player. Extra moves are dropped without counting.
- One live game per player. Starting a new game while playing on after a result stops the old
  one. Starting one during a live race is refused.
- An account signed in on a second device takes over. The first one is told and disconnected.

## Difficulty

Chosen per match. The same generator as the prototype: `(seed, difficulty)` always gives the
same puzzle, with exactly one solution.

| Tier | Rule |
|---|---|
| Medium | Needs locked candidates or pairs, nothing harder |
| Hard | Needs triples or X-wing, or 3+ pair-level steps (the prototype's solo puzzles) |
| Extreme | Needs swordfish or XY-wing |

There is no easy tier. Every puzzle has exactly one solution, and a logical solver checks it,
so no puzzle needs guessing.

The server keeps 4 ready puzzles per tier, made on a worker thread.

## Rating

- **Glicko-2**, the system chess.com and Lichess use. Checked against the worked example in
  Glickman's paper (`test/glicko2.test.js`).
- **One rating per difficulty**, the way chess has one per time control.
- Starting values are rating 1500, RD 350 and volatility 0.06, with τ = 0.5. RD stays between 45 and 350.
- Each game is rated right after it ends, using both players' ratings from before the game.
  Draws count as 0.5.
- Shown as `1500?` while RD > 110 (provisional). The leaderboard lists only settled ratings.
- RD grows by one Glicko-2 period per full idle week, so a returning player's rating moves
  faster.
- **What keeps it honest:**
  - Only the server rates games.
  - Only ranked games between two different accounts are rated.
  - Each game is rated once: an atomic flag in the same database transaction as the update.
  - Aborted games are never rated.
  - The client never receives the solution.
  - Every move is stored with its time, for later review.

### Matchmaking

- One queue per difficulty. Each second the server pairs the longest-waiting players first,
  picking the closest rating within a window.
- The window is ±150 and widens by 50 every 5 s of waiting. After 60 s, anyone matches.
- Who sits in which seat is random.

### Known limits (fine for the test, needed before a public launch)

- A program can solve any sudoku instantly. The server cannot stop that, only detect it.
  Moves are logged with timestamps for that purpose.
- Two accounts owned by the same person can trade wins.
- Time is measured when the server receives a move. Network delay counts against a player, the
  same as in online chess.

## Friend games

- **Link or code:** creating a game gives a 6-character code and a link `/#r=CODE`. The game
  starts when someone opens it. The link expires after 15 minutes or when the creator leaves.
- **Challenge (accounts):** pick an online friend, choose rules, they get Accept / Decline.
- **Custom rules:** difficulty and mistake limit. No curses for now.
- **Rematch:** both press it, a new puzzle starts with the same rules, and the seats swap.
- Friend games are never rated. For accounts they count in stats.

## Friends (accounts)

- Add by username, which sends a request.
- If they already asked you, adding them accepts it.
- The list shows online, in-game and offline, and you can remove a friend.

## Stats (accounts)

- Rating, games, wins, losses, draws and peak, per difficulty.
- All-game won/lost/drawn.
- Current and best win streak.
- Fastest solve per difficulty.
- The last 20 games.

## Customization

- **Free now:** avatar (12 symbols × 8 colors) and board theme (Night, Paper, Slate, Ocean). Pressing a cell shades its row, column and box gray, fading with distance. The pressed cell is dark blue and every copy of the chosen number is blue. Nothing shows where a number can still go.
  Saved on the account, or on the device for guests.
- **Paid later:** extra customization in a shop. Not built.

## Accounts

- Username: 3–16 letters, digits or `_`, unique regardless of case. Names starting with "guest"
  are reserved.
- Password: 8–128 characters, stored as a salted scrypt hash.
- Sessions use random 256-bit tokens, stored hashed.
- Rate limits: 10 logins per 15 min per address and name, 5 sign-ups per hour per address, and
  30 friend requests per hour.

## Platforms

Browser, iOS and Android, like chess.com. One web client: the server hosts it for the browser, and
Capacitor wraps it for the apps (see the README).

## Not decided yet

- The test plan: who tests, and what counts as a pass (answers 19 and 20).
- Opponent interaction: curses are kept out until you've checked the core.
