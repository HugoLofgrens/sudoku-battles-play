# Sudoku Battles: test version

Live 1v1 sudoku races with Glicko-2 ranked, friends, guests and solo. A Node server plus a web
client that works in any phone or desktop browser. The rules are in [docs/SPEC.md](docs/SPEC.md),
and the API for any client is in [docs/PROTOCOL.md](docs/PROTOCOL.md).

## Run

**On your Wi-Fi (simplest):** install Node.js 22.13+ and double-click `start.bat`, or run
`./start.sh` on Mac/Linux. It prints the address phones on the same Wi-Fi should open. See
`PLAY-ON-WIFI.txt`.

**From a terminal:** `npm install` then `npm start`. `PORT` and `DB_FILE` change the port and the
database path (default `data/sudoku.db`). The only package is `ws`.

**Free online:** on render.com, New > Blueprint, then pick this repository (`render.yaml`). The free
plan sleeps when idle and wipes its disk on restart, so accounts reset.

**Downloads:** every push builds `sudoku-battles-wifi` (the server, ready to run) and
`sudoku-battles-android-debug` (the APK). Find them on the run's page under Actions.

## Test

```
npm test             # 36 tests: puzzles, rating math and a simulated ladder, every match rule, daily, stats, the server end to end
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
| `server/glicko2.js` | Glicko-2 math |
| `server/rating.js` | Shown rating (500..10,000), margin bonus |
| `server/daily.js` | The daily puzzle |
| `server/stats.js` | Time stats and time leaderboards |
| `shared/tiers.js`, `shared/facts.js` | Rank tiers; the facts and tips line |
| `client/settings.js`, `sound.js`, `fx.js`, `charts.js` | Settings, sound and haptics, animation, SVG charts |
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
compile. The Android build produces an APK you can install on a phone.

Without `SERVER_URL`, the app shows a Server box where you type the address of the computer
running the server, e.g. `192.168.1.20:8080`. Set the repository variable `SERVER_URL` to bake
in an online server. The apps allow plain `http` so they can reach a server on your Wi-Fi.
Turn that off before store release.

Icons and splash screens come from `mobile/assets/make_icons.py`.

**Still needed for the stores:**
- **Apple:** a Developer account ($99/year). Signing and TestFlight can also run on GitHub's
  macOS machines.
- **Google:** a Play Console account ($25 once) and a signing key.
- **Both:** app icons and a splash screen.

