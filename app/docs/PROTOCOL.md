# Server protocol

The contract for every client: the web client now, native apps later. JSON everywhere.

## HTTP

Send `Authorization: Bearer <token>` where marked (🔒). Errors come back as `{ "error": "message" }`
with a 4xx/5xx status.

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/register` | `{name, password, avatar?}` | 201 `{token, me}` |
| POST | `/api/login` | `{name, password}` | `{token, me}` |
| POST | `/api/logout` 🔒 | | `{}` |
| GET | `/api/me` 🔒 | | `me` |
| POST | `/api/me/look` 🔒 | `{avatar:{s,c}, theme}` | `me` |
| GET | `/api/profile/:name` | | ratings, totals, streaks, last 20 games, `times` (per difficulty: count, best, mean, median, p25, p10, p5, fasterThan, of), `history` (per difficulty: `[[at, rating]]`) |
| GET | `/api/leaderboard/:difficulty` | | top 50 ratings `{name, avatar, rating, provisional, tier, games}` |
| GET | `/api/times/:difficulty?kind=fastest\|median&period=all\|week` | | time board `{name, avatar, time, solves?}` |
| GET | `/api/daily` (🔒 optional) | | `{day, number, difficulty, resetsAt, solved, board:[{name, avatar, time, mistakes}], you:{status, time, mistakes, rank}\|null}` |
| GET | `/api/friends` 🔒 | | `[{name, avatar, status: friend\|incoming\|outgoing, online, playing}]` |
| POST | `/api/friends/add` 🔒 | `{name}` | `{status: pending\|accepted}` |
| POST | `/api/friends/accept` 🔒 | `{name}` | `{status}` |
| POST | `/api/friends/remove` 🔒 | `{name}` | `{}` (also declines and cancels requests) |

`me` = `{id, name, avatar, theme, guest:false, ratings:{medium|hard|extreme:{rating, provisional, tier, games, wins, losses, draws, peak}}}`. Ratings are the shown 500..10,000 numbers; Glicko values stay on the server.

## WebSocket `/ws`

The first message must be `hello`. One socket per identity: a new one replaces the old.

### Client → server

| `t` | Fields | Meaning |
|---|---|---|
| `hello` | `token?` or `guest?` | Log in with an account token, resume a guest, or (neither) become a new guest |
| `queue` | `difficulty` | Join ranked matchmaking (accounts only) |
| `unqueue` | | Leave matchmaking |
| `room.create` | `difficulty, mistakes (1/3/5), invite?` | Friend game; `invite` = a friend's name for a challenge |
| `room.join` | `code` | Join by code, or accept a challenge |
| `room.cancel` | | Cancel your open room |
| `challenge.decline` | `code` | |
| `place` | `cell (0-80), digit (1-9)` | A move in your current game |
| `resign` | | Before the result: give up (lose). After it: stop playing on |
| `abort` | | Only in the first 20 s, before trying any cell |
| `rematch` | `game` | Friend games, after the result |
| `leave` | | Done looking at a finished game |
| `daily.start` | | Start (or resume) today's daily; answered with `daily`, or `daily.done` if already played |
| `daily.place` | `cell, digit` | A daily move |
| `daily.giveup` | | End today's attempt |
| `ping` | | Answered with `pong {serverNow}` |

### Server → client

| `t` | Fields |
|---|---|
| `welcome` | `me, guestToken?, serverNow, rules` (store `guestToken` to stay the same guest) |
| `error` | `code, message`. `bad-token` means log in again |
| `queued` / `unqueued` | `difficulty, since, rating` |
| `room` / `room.closed` | `code, rules, invite` |
| `challenge` | `code, rules, from:{name, avatar}` |
| `challenge.gone` / `challenge.declined` | |
| `friends` | Your friends list changed; fetch it again |
| `replaced` | Opened somewhere else |
| `placed` | `cell, digit, ok` (`true` right, `false` mistake, `null` refused with `reason`) |
| `game` | The full game view, sent after every change (below) |
| `daily` | `{day, number, difficulty, puzzle, board, toFill, filled, mistakes, mistakesAllowed, status: playing\|solved\|out\|gaveup\|timeout, time, startedAt, serverNow, capAt}` |
| `daily.placed` | like `placed` |
| `daily.done` | `{day, status, time, mistakes}`: already played today |

### The game view

```
{ t:'game', id, kind: ranked|casual, difficulty, mistakesAllowed,
  status: waiting|live|decided|closed|aborted,
  puzzle[81], board[81] (yours, confirmed digits only), toFill,
  startAt, serverNow, capAt, canAbort,
  you: {index, name, avatar, rating, guest, filled, mistakes, done, time},
  opp: {name, avatar, rating, guest, filled, mistakes, done, time, connected},
  result: {winner, reason, at, you: win|loss|draw} | null,
  ratingChange: {before, after, delta, provisional, tier, margin (0-100), gain (1-2)} | null,
  rematch: {you, opp},
  timeline: {you: [[ms, 1|0]], opp: [[ms, 1|0]]} | null }   // after the result: each move, right (1) or mistake (0)
```

`done` is null while playing, otherwise `solved | out | gaveup | disconnect | timeout`.
`time` is the solve time in ms, or null. Clock offset = `serverNow - localNow`; the race clock is
`localNow + offset - startAt`.
