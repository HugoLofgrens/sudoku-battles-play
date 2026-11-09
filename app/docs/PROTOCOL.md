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
| GET | `/api/profile/:name` | | profile with ratings, totals, streaks, best times, last 20 games |
| GET | `/api/leaderboard/:difficulty` | | top 50 settled ratings |
| GET | `/api/friends` 🔒 | | `[{name, avatar, status: friend\|incoming\|outgoing, online, playing}]` |
| POST | `/api/friends/add` 🔒 | `{name}` | `{status: pending\|accepted}` |
| POST | `/api/friends/accept` 🔒 | `{name}` | `{status}` |
| POST | `/api/friends/remove` 🔒 | `{name}` | `{}` (also declines and cancels requests) |

`me` = `{id, name, avatar, theme, guest:false, ratings:{easy|medium|hard:{rating, rd, provisional, games, wins, losses, draws, peak}}}`

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

### The game view

```
{ t:'game', id, kind: ranked|casual, difficulty, mistakesAllowed,
  status: waiting|live|decided|closed|aborted,
  puzzle[81], board[81] (yours, confirmed digits only), toFill,
  startAt, serverNow, capAt, canAbort,
  you: {index, name, avatar, rating, guest, filled, mistakes, done, time},
  opp: {name, avatar, rating, guest, filled, mistakes, done, time, connected},
  result: {winner, reason, at, you: win|loss|draw} | null,
  ratingChange: {before, after, delta, provisional} | null,
  rematch: {you, opp} }
```

`done` is null while playing, otherwise `solved | out | gaveup | disconnect | timeout`.
`time` is the solve time in ms, or null. Clock offset = `serverNow - localNow`; the race clock is
`localNow + offset - startAt`.
