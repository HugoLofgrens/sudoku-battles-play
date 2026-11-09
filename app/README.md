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

## Browser, iOS and Android

Like chess.com: the same game in the browser and in both app stores, from one codebase. The
apps are the web client inside a Capacitor shell (`mobile/`).

| Platform | How |
|---|---|
| Browser | The server hosts the client. Open the site |
| Android | `mobile/android`, a native Android Studio project |
| iOS | `mobile/ios`, a native Xcode project (Swift Package Manager, no CocoaPods) |

The client has to be told where the server is, because inside an app the page doesn't come
from the server:

```
cd mobile && npm ci
SERVER_URL=https://your-server npm run build    # copies client/ + shared/ into www/
npx cap sync                                     # copies www/ into both native projects
```

GitHub Actions (`.github/workflows/apps.yml`) runs the tests and then builds both apps on every
push. Android builds on Linux. iOS builds on GitHub's macOS machines, so no Mac is needed to
compile. The Android build produces an APK you can install on a phone. Set the repository
variable `SERVER_URL` so the builds point at the live server.

**Still needed for the stores:**
- **Apple:** a Developer account ($99/year). Signing and TestFlight can also run on GitHub's
  macOS machines.
- **Google:** a Play Console account ($25 once) and a signing key.
- **Both:** app icons and a splash screen.

