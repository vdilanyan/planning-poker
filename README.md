# Planning Poker

A free, no-login planning poker tool. Create a room, share its link, and everyone votes in secret.
Votes stay hidden until someone presses **Reveal**.

Each room has two tabs: **Poker** (2, 3, 5, 8, 13) and **Confidence** (3–10, with an average; Poker shows no average).
The header has a **TUI mode** button that restyles the whole UI as a terminal (remembered in the browser).

## Rooms and links

- Open `/` and press **Create room**. You land on `/r/<code>`, where `<code>` is a random 10-character code generated in your browser.
- **The link is the key.** Anyone who has the link can join. There are no accounts and no passwords, so share it only with the people you want in the room.
- To join, open the link, or paste a link (or just the code) into **Paste a room link or code** on the home page.
- Rooms are isolated: each has its own participants, votes and reveal state.
- Rooms are created on demand the first time someone connects to a valid code. A shared link keeps working even if the server restarted and lost its state (for example on a free host without a disk).
- A room that nobody is connected to is deleted after being **idle for 7 days**. Rooms may be dropped earlier if the server is full (oldest idle first, and never one used in the last hour).
- Limits: **50** connected people per room, **200** remembered people per room (the longest-gone person without a vote is forgotten to make space), and **500** rooms per server. If the server is full of busy rooms, new rooms are refused until one frees up.
- Your name is asked once per browser (stored in `localStorage`) and reused in every room. **Copy link** in the room header copies the room URL.

## Run locally

Requires Node 22 or newer (`engines: >=22`).

```bash
npm install
npm run build
npm start            # http://localhost:3000
```

Open http://localhost:3000, press **Create room**, and share the link.

Development (hot reload): run `npm run dev:server` and `npm run dev:client` in two terminals, open http://localhost:5173.

## Configuration

| Variable      | Default                  | Meaning                                                        |
|---------------|--------------------------|----------------------------------------------------------------|
| `PORT`        | `3000`                   | HTTP/WebSocket port                                            |
| `DATA_FILE`   | `<repo>/data/state.json` | Where the rooms are persisted                                  |
| `TRUST_PROXY` | off                      | Set to `1` to read the client IP from `X-Forwarded-For`        |

In Docker, `DATA_FILE` defaults to `/data/state.json`.

**`TRUST_PROXY`:** the per-IP limits (see below) need the real client address. Behind a reverse proxy or hosting platform that sets `X-Forwarded-For`, set `TRUST_PROXY=1` so the first entry of that header is used; otherwise every visitor looks like the proxy and shares one limit. **Never set it when the server is directly exposed to the internet:** clients could then send their own `X-Forwarded-For` and dodge the limits.

## Docker

```bash
docker build -t planning-poker .
docker run -p 3000:3000 -v poker-data:/data planning-poker
```

- The container runs as the unprivileged `node` user. The image creates `/data` owned by `node`, so a named volume (`-v poker-data:/data`) works as is. If you bind-mount a host directory instead, make it writable by uid 1000 (`node`).
- The image sets `DATA_FILE=/data/state.json`. The `-v poker-data:/data` volume is what keeps rooms across container restarts.
- On a host without a persistent disk, rooms are lost when the app restarts, but room links still work: the room is simply created again, empty, the next time someone opens it.
- `docker stop` sends SIGTERM, which triggers a graceful shutdown that saves state first.
- The container listens on `PORT` (default 3000), and a HEALTHCHECK polls `/healthz`.

An older single-room `state.json` is not compatible with this version: it is moved aside as `state.json.corrupt-<timestamp>` and the server starts empty.

## Tests

```bash
npm test
npm run typecheck
npm run build
```

## Notes

- Votes stay hidden (the server never sends other people's values) until someone presses **Reveal**.
- **Delete Estimates** clears only the current tab. **Hide** re-hides revealed votes without deleting them.
- The browser remembers your identity in `localStorage` (`planning-poker.user`). Clearing site data makes you enter your name again.

## Security notes

- **No authentication.** Anyone with a room link can join, vote, reveal, hide and delete estimates in that room. Treat the link like a shared secret.
- Do not put sensitive text in your name: it is visible to everyone in the room.
- Room codes are random and hard to guess, but they are not a substitute for access control. Do not use this for confidential material.
- Abuse limits:
  - One `join` per connection (a second `join` with a different identity closes the connection), and a connection that does not join within 10 seconds is closed.
  - 50 connections per room, 200 remembered people per room, 500 rooms per server.
  - Per client IP: at most 30 concurrent connections and 20 new rooms per 10 minutes (see `TRUST_PROXY` above).
  - 4 KB maximum message size, and a connection that sends more than 30 messages in one second is disconnected.
  - The server pings every connection every 30 seconds and drops those that stop answering, so people who vanish do not stay "online".
  - Names have control and bidirectional-override characters removed.
- Run it behind HTTPS in production (a reverse proxy or your host's TLS). The client uses `wss://` automatically on https pages, and without HTTPS links and votes travel in clear text.

## License

[MIT](LICENSE)
