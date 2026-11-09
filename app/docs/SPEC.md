# Sudoku Battles: test version spec

Hugo's answers from 2026-11-09 are the source. Every number here is the value in the code
(`server/match.js` `RULES`, `server/rating.js`, `server/glicko2.js`, `server/daily.js`,
`server/stats.js`). Change both together.

## Product

Like chess.com, for sudoku: simple, fast, no ads. Live 1v1 speed races, a rating ladder,
friends, custom rules for friend games. Extras come later.

| Who | Can do |
|---|---|
| Guest (no login) | Solo, 1v1 with a friend by link or code, the daily puzzle (not on its board). No stats, no rating. |
| Account | Everything a guest can, plus ranked vs strangers, ratings, time stats, leaderboards, friends, challenges. |

Tabs: **Play** (daily, ranked, friend, solo), **Ranks** (leaderboards), **Friends**, **Profile**
(stats, graphs, settings, look).

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

Chess.com-style, with a bonus for big wins (Hugo, 2026-11-09).

- **Math:** Glicko-2, the family chess.com and Lichess use, on its standard 1500 scale and
  checked against Glickman's worked example. Start RD 350, volatility 0.06, τ = 0.5, RD 45–350.
  Each game is rated right after it ends, from both players' pre-game values. Draws count 0.5.
  RD grows one period per idle week.
- **What players see:** `shown = 500 · e^(0.45 · μ)`, with μ the Glicko skill in its own units.
  - Everyone starts at **500**.
  - Better than average climbs ever faster; only an extreme outlier nears **10,000**, the hard
    cap.
  - Worse than average sinks toward 0 but never goes below 1.
  - Points scale with your level, so a win near 5,000 moves about 10× more than one near 500.
  - Ranking order is the Glicko order, so the curve changes nothing about who is better.
  - Retune 0.45 once real players exist, so that the #1 sits near 10,000.
- **Margin bonus:** the rating change is multiplied by a gain from 1 (photo finish) to 2
  (blowout), for both players.
  - Solve: margin = the share of the puzzle the loser still had left. That equals the time
    gap, because a loser at fraction f would need 1/f of the winner's time.
  - Mistakes-out, give-up, disconnect: full margin. Quitting is never cheaper than losing.
  - Time cap: the difference in progress. Draw: no bonus.
  - When the favorite wins, the bonus is damped (2.2 / (2.2 + 0.001 · rating gap)), so
    crushing much weaker players doesn't farm points.
- **Tiers** (by shown rating): Bronze < 400, Silver 400, Gold 700, Platinum 1000, Diamond 1400,
  Master 1900, Grandmaster 2500. While RD > 110, the tier reads **Placement** and the rating
  is marked `?`.
- **One rating per difficulty**, like chess's time controls.
- **What keeps it honest:**
  - Only the server rates games, and only ranked games between two different accounts.
  - Each game is rated once: an atomic flag in the same transaction as the update.
  - Aborted games are never rated, including games cut off by a server restart.
  - The client never gets the solution.
  - Every move is stored with its time.
  - The same two accounts aren't paired again within 10 minutes, unless one has waited 30 s.
- `test/rating.test.js` simulates a 120-player ladder: rating order matches hidden skill (rank
  correlation > 0.95) and the average does not drift.

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

## Daily puzzle

- One puzzle for everyone per UTC day, from a seed of the date.
- Difficulty by weekday: Monday and Tuesday Medium; Wednesday to Friday Hard; Saturday and
  Sunday Extreme.
- **One attempt per account**, timed by the server from Start. The clock keeps running if you
  leave.
- 3 mistakes and you're out; 90-minute cap.
- The daily board ranks solves by time. Guests can play but aren't on it.
- After a server restart, an attempt in progress is lost and can be started again.

## Time stats and leaderboards

Only server-timed solves count: race solves (including "keep going" finishes) and daily
solves. Solo times are kept on the device only.

- **Your times** (per difficulty):
  - median, average, fastest, and the times of your best 25%, 10% and 5% of solves;
  - after 5 solves, "faster than X% of players", comparing medians with every other player
    who has 5 or more.
- **Ranks tab:**
  - Rating (everyone with a rated game; `?` while provisional).
  - Fastest single solve and best median (needs 10 solves all-time, 5 this week). Both have
    all-time and this-week (Monday UTC) views.
  - Today's daily board.
- **Graphs:** your rating after every rated game, per difficulty. After a race, a replay chart
  of both players' progress over time, with mistakes marked.

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

- Rating, tier, games, wins, losses, draws and peak, per difficulty.
- All-game won/lost/drawn, current and best win streak, the last 20 games.

## Feel and customization

- **Highlighting:** only what a player could see on paper. A pressed cell shades its row,
  column and box gray, fading with distance; the pressed cell is dark blue and every copy of
  the chosen number is the accent color. Nothing shows where a number can still go.
- **Feedback:**
  - A correct digit pops.
  - A finished row, column or box ripples.
  - A mistake shakes the board.
  - A win throws confetti.
  - The countdown ticks.
  - Sound and vibration are on by default. Vibration uses Capacitor Haptics in the apps.
- **Settings** (on the device): sound, vibration, numbers-left counts on the pad (default on).
- **Look (free):**
  - avatar (12 symbols × 8 colors) and theme (Night, Paper, Slate, Ocean), saved on the
    account;
  - accent (Blue, Indigo, Teal, Violet, Rose), board style (Classic, Tiles, Minimal) and
    number font (Clean, Rounded, Mono, Serif), saved on the device.
- **Facts line:** a rotating fact or tip in the middle of Play and on every waiting screen.
  The facts are checked; see the memory file SB2. Lines are short.
- **Paid later:** extra customization in a shop. Not built.

## Accounts

- Username: 3–16 letters, digits or `_`, unique regardless of case. Names starting with "guest"
  are reserved.
- Password: 8–128 characters, stored as a salted scrypt hash.
- Sessions use random 256-bit tokens, stored hashed, and expire after 90 days unused.
- The database schema is versioned (`PRAGMA user_version`); migrations run in order at start.
- Rate limits: 10 logins per 15 min per address and name, 5 sign-ups per hour per address, and
  30 friend requests per hour.

## Platforms

Browser, iOS and Android, like chess.com. One web client: the server hosts it for the browser, and
Capacitor wraps it for the apps (see the README).

## Not decided yet

- The test plan: who tests, and what counts as a pass (answers 19 and 20).
- Opponent interaction: curses are kept out until you've checked the core.
