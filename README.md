# Group Video Call

Group video calling built with [mediasoup](https://mediasoup.org) (SFU), Node.js + TypeScript signaling server and a Next.js + TypeScript client. Users enter a group id on the landing page and join a call with everyone else in that group.

## Structure

- `server/` — Express + Socket.IO signaling server and mediasoup media server
- `client/` — Next.js app: landing page (group id + name) and the call room
- `deploy/` — Docker Compose + Caddy (HTTPS) setup with deployment guides for [AWS EC2](deploy/EC2.md) and [Oracle Cloud](deploy/README.md)

## Running locally

Terminal 1 — media server (port 4000):

```bash
cd server
npm install
npm run dev
```

Terminal 2 — client (port 3000):

```bash
cd client
npm install
npm run dev
```

Open http://localhost:3000 in two browser tabs, enter the same group id with different names, and the two tabs will be in a call together.

## Environment variables

Server:

- `PORT` — HTTP/WebSocket port (default `4000`)
- `ANNOUNCED_IP` — IP announced in ICE candidates (default `127.0.0.1`). Set to your LAN/public IP to join from other devices.
- `RTC_MIN_PORT` / `RTC_MAX_PORT` — UDP/TCP media port range (default `40000–40100`)
- `NUM_WORKERS` — mediasoup workers (default `1`)
- `CLIENT_ORIGIN` — CORS origin (default `*`)

Client (`client/.env.local`):

- `NEXT_PUBLIC_SERVER_URL` — media server URL (default `http://localhost:4000`)

## Notes

- `getUserMedia` needs a secure context: `localhost` works out of the box, but testing from other devices requires HTTPS (or a tunnel) plus `ANNOUNCED_IP` set to a reachable IP and the media port range open.
- One mediasoup router is created per group id and closed when the last participant leaves.

## Signaling flow

1. `joinRoom` — registers the peer, returns router `rtpCapabilities`, current peers and their producers
2. `createTransport` / `connectTransport` — one send and one receive WebRTC transport per peer
3. `produce` — publishes a local audio/video track; the server broadcasts `newProducer` to the group
4. `consume` + `resumeConsumer` — subscribes to a remote producer (created paused, resumed after the client attaches the track)
5. `toggleProducer` — mute / camera off (server broadcasts `producerToggled`)
6. On disconnect the server closes the peer's transports, emits `peerLeft`, and closes the room when empty
