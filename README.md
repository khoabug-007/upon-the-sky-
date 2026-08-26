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

## Deploy on Vercel (WebGL client)

This GitHub repo is the **browser / WebGL** game only (not Unity).

1. Import [khoabug-007/upon-the-sky-](https://github.com/khoabug-007/upon-the-sky-) on [vercel.com](https://vercel.com/new).
2. Leave the defaults from `vercel.json`: build `npm run build`, output `dist`, framework Vite.
3. Deploy. Open the `*.vercel.app` URL.

**Climb Solo**, **Create Server**, **Find Server**, and **Join** all work on that URL. Create Server opens a browser room (WebRTC). Share the 6-letter code. Keep the host tab open.

Optional: for a shared public lobby list (Join Server board), also run `server/index.js` on Render/Railway/Fly and set Vercel env `VITE_SOCKET_URL` to that host, then Redeploy.

## Public deploy with multiplayer (Render, Railway, Fly)

Needs a **persistent Node process** with WebSockets.

1. Use `render.yaml` or the `Dockerfile`. Build: `npm ci && npm run build`. Start: `npm start`.
2. Set `NODE_ENV=production`. The host sets `PORT`.
3. Share that **https** URL. Friends join with the 6-letter room code.

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
