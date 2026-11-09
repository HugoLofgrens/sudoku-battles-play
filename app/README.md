# Sudoku Battles: test version

Live 1v1 sudoku races with Glicko-2 ranked, friends, guests and solo. A Node server plus a web
client that works in any phone or desktop browser. The rules are in [docs/SPEC.md](docs/SPEC.md),
and the API for any client is in [docs/PROTOCOL.md](docs/PROTOCOL.md).

## Run

```
npm install
npm start            # http://localhost:8080, data in data/sudoku.db
```

`PORT` and `DB_FILE` change the port and database path. Needs Node 22.5+, which has SQLite built
in. The only package is `ws`.

## Test

```
npm test             # 24 tests: rating math, every match rule, the server end to end
npm run e2e          # real browser: guests by link, accounts in ranked, friends, solo
```

`npm run e2e` needs Playwright. If it is installed globally rather than in the project, set
`NODE_PATH` to the global `node_modules` folder first. Screenshots are saved to `e2e-shots/`.

## Layout

| Path | What |
|---|---|
| `shared/sudoku.js` | Generator, solver and grader, moved unchanged from the prototype |
| `shared/looks.js` | Avatars and themes |
| `server/match.js` | Every race rule, as pure logic |
| `server/glicko2.js` | Rating math |
| `server/db.js` | SQLite tables and queries |
| `server/app.js` | HTTP API, WebSocket hub, matchmaking, rooms |
| `client/` | Web client: plain JavaScript modules, no build step |

## Client technology

Answer 17 was native apps (C). The server and protocol don't depend on that choice. The web
client exists because it is the fastest way to test with friends: you send a link and nothing
needs installing. A native iOS app needs a Mac with Xcode to build and test. Decide how to
handle that before native work starts.
