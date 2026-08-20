# UPON THE SKY

A funny multiplayer 3D parkour game. Climb from the earth ground, through the clouds, all the way to outer space — powered by teamwork and a healthy amount of trolling.

## Run the game

```bash
npm install

# Terminal 1 - the multiplayer server
npm run dev:server

# Terminal 2 - the game client (development)
npm run dev
```

Open http://localhost:5173, create a server, share the 6-letter code with friends.

## Production (one process serves everything)

```bash
npm run build
npm start
```

Then open http://localhost:3000.

## Public deploy (Render, Railway, Fly, etc.)

This game needs a **persistent Node process** with WebSockets — static hosts (GitHub Pages, Netlify static) will not work.

1. Connect this repo to a Node-capable host (Render Blueprint: use `render.yaml`; Railway/Fly: use the `Dockerfile` or set build to `npm ci && npm run build` and start to `npm start`).
2. Set `NODE_ENV=production`. The host usually sets `PORT` automatically; the server reads `process.env.PORT` (default 3000).
3. After deploy, share the public **https** URL. Everyone opens that URL in a browser (not `localhost:5173`). Create a server, share the 6-letter room code; friends use **Join Server**.

Local production still works the same way: `npm run build && npm start`, then open http://localhost:3000.

## Controls

| Action | Key |
|---|---|
| Move | W A S D |
| Run | hold Shift |
| Crawl | R |
| Jump | Space |
| Punch | E |
| Pick up player / object | Q |
| Throw | B |
| Grasp (climbing handles) | hold Left Mouse |
| Look around | Mouse (click screen first) |

## Features

- Character editor: 3 pull bars (1-100) for head, body and legs
- Join Server board, Find Server by code, Create Server
- 11 obstacles from grass to space, checkpoint after each one (auto-saved)
- Zero-gravity ending in outer space with a thank-you message
- Punch, carry and yeet your friends. For teamwork reasons.
