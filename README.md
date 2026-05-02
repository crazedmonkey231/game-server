# game-server

A lightweight, TypeScript-based multiplayer game server built for game-jam projects. It handles real-time multiplayer connections via **Socket.IO**, REST endpoints for leaderboards and profiles, admin event management, and an in-browser admin dashboard.

---

## Features

| Feature | Details |
|---|---|
| **Multiplayer rooms** | Socket.IO-based rooms with player join / leave / change-room |
| **Server tick** | 30 Hz game-state update loop per game |
| **Leaderboards** | Per-game top-10 leaderboard via REST and socket |
| **Player profiles** | Ephemeral in-memory profiles with credits and stats |
| **Event system** | Timed in-game events (e.g. Double XP Weekend) via REST or timer |
| **Admin dashboard** | Live browser UI for statistics, player counts, and event management |
| **TypeScript** | Fully typed with strict mode enabled |

---

## Quick Start

### Prerequisites

- Node.js 18+
- npm 9+

### Install & run

```bash
# 1. Clone
git clone https://github.com/crazedmonkey231/game-server.git
cd game-server

# 2. Install dependencies
npm install

# 3. Copy env template and adjust if needed
cp .env.example .env

# 4a. Development (hot-reload via tsx)
npm run dev

# 4b. Production build then start
npm run build
npm start
```

The server starts on `http://localhost:3000` (or the port set in `.env`).

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port the server listens on |

Copy `.env.example` to `.env` and edit as needed.

---

## Project Structure

```
game-server/
├── src/
│   ├── server.ts               ← Entry point
│   ├── types/
│   │   └── index.ts            ← Shared TypeScript interfaces
│   ├── managers/
│   │   ├── GameManager.ts      ← Game loop, socket handling
│   │   ├── LeaderboardManager.ts
│   │   ├── EventManager.ts
│   │   └── ProfileManager.ts
│   ├── games/
│   │   ├── BaseGame.ts         ← Abstract base class
│   │   ├── DefaultGame.ts      ← Physics/movement demo game
│   │   └── CreationGame.ts     ← Hex-tile dice game
│   └── utils/
│       └── index.ts            ← getPlayer, getThing, fetchJson helpers
├── games/
│   └── CreationGameData/
│       └── level.json          ← Level data for CreationGame
├── public/
│   ├── index.html              ← Admin dashboard
│   ├── dashboard.css
│   └── dashboard.js
├── examples/                   ← Client-side usage examples
├── .env.example
├── tsconfig.json
└── package.json
```

---

## Adding a New Game

1. Create `src/games/MyGame.ts` extending `BaseGame`:

```ts
import type { Server as IOServer } from 'socket.io';
import type { Room } from '../types/index.js';
import { BaseGame } from './BaseGame.js';

export class MyGame extends BaseGame {
  readonly name = 'MyGame';
  readonly description = 'My awesome game.';
  isPersistent = false;

  create(room: Room): void {
    // Initialize room state here
  }

  update(io: IOServer, game: Room, outState: unknown[]): void {
    // Called 30× per second. Push changed things into outState.
  }
}
```

2. Register the game in `src/server.ts`:

```ts
import { MyGame } from './games/MyGame.js';

const GAMES: Record<string, new () => IGame> = {
  'my-game': MyGame,
  // ...existing games
};
```

3. Clients connect with `?gameId=my-game&roomId=lobby&name=Player1` in the Socket.IO query string.

### Optional `IGame` hooks

| Method | Description |
|---|---|
| `addAiPlayers(): Player[]` | Return AI player objects to add on room join |
| `aiPlayerMax(): number` | Maximum AI players per room (default 0) |

---

## API Reference

### GameManager

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/gameManager/playerNotify` | Broadcast a message to all connected players |
| GET | `/api/gameManager/summary` | `{ totalPlayers, activeGames }` |
| GET | `/api/gameManager/playersInAllGames` | `{ playerCount }` |
| GET | `/api/gameManager/playersInPerGames` | `{ playerCounts: { [gameId]: number } }` |
| GET | `/api/gameManager/playersInGame/:gameId/:roomId` | `{ playerCount }` |

### Leaderboard

| Method | Endpoint | Body / Query | Description |
|---|---|---|---|
| POST | `/api/leaderboard/:gameId/submit` | `{ name, score }` | Submit a score |
| GET | `/api/leaderboard/:gameId` | `?limit=10` | Get top entries |

### Events

| Method | Endpoint | Body | Description |
|---|---|---|---|
| POST | `/api/eventManager/triggerEvent` | `{ gameId, type, length?, data? }` | Start an event (`length` in ms) |
| GET | `/api/eventManager/getEvents/:gameId` | — | List active events for a game |

### Profiles

| Method | Endpoint | Body | Description |
|---|---|---|---|
| POST | `/api/profile/createAccount` | `{ socketId, username }` | Create a profile |
| POST | `/api/profile/login` | `{ socketId, username }` | Login / verify profile |
| GET | `/api/profile/search/:socketId` | — | Get profile by socket ID |
| GET | `/api/profile/all` | — | Get all in-memory profiles |
| GET | `/api/profile/globalStats` | — | `{ globalCredits, globalPlayTime }` |

---

## Socket.IO Events

### Client → Server

| Event | Payload | Description |
|---|---|---|
| `playerInput` | `Record<string, unknown>` | Send player input each frame |
| `playerChangeRoom` | `newRoomId: string` | Move to a different room |
| `submitLeaderboardEntry` | `{ name, score }` | Submit score via socket |
| `getManagedEvents` | — | Request active events for the connected game |

### Server → Client

| Event | Payload | Description |
|---|---|---|
| `init` | `{ you, game }` | Sent on connection with initial game state |
| `serverUpdate` | `{ things }` | 30 Hz state updates for changed objects |
| `playerJoined` | `{ player, game, playerCount? }` | A player joined the room |
| `playerLeft` | `{ playerId, playerCount? }` | A player left the room |
| `playersMoved` | `{ toRoom }` | Players were moved to another room |
| `gameEnded` | `{ reason }` | The game ended |
| `playerNotify` | `{ message }` | Admin broadcast notification |
| `eventStarted` | `{ gameId, type, data }` | An event became active |
| `eventEnded` | `{ gameId, type }` | An event expired |
| `leaderboardEntrySubmitted` | `{ entry, isInTop10 }` | Score submission result |
| `managedEvents` | `{ events }` | Active events list response |

---

## Admin Dashboard

Visit `http://localhost:3000` in a browser to open the admin dashboard. It auto-refreshes every 5 seconds and provides:

- **Server Statistics** — live player count, active game count, global gold, and total playtime
- **Players per Game** — per-game player breakdown
- **Active Events** — all running events with remaining time
- **Trigger Event** — form to start a new event on any game
- **Admin Login** — verify a profile by socket ID and username

---

## Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start dev server with hot-reload (tsx watch) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run compiled server from `dist/` |
| `npm run lint` | Lint `src/` with ESLint |
