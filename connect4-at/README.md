# AT Connect Four

A working two-player Connect Four website using **AT Protocol repositories to exchange moves**. Each player signs in with a different AT Protocol account and publishes moves to their own repository. The Node server is a lightweight match rendezvous service and game-state reader, **not** a centralized move database.

## Start

1. Install Node.js 20+.
2. In this folder run `npm install` then `npm start`.
3. Open `http://localhost:3000` in two browser windows (or different browsers). You can also open it from another computer if it can reach the server.
4. Sign in with **two different Bluesky accounts** using **app passwords** (Bluesky Settings → Privacy and security → App passwords). Never use your main password.
5. In the first browser choose **Create match**, then **Copy invite code**.
6. In the second browser paste the code and choose **Join match**.
7. Take turns; both boards automatically poll for updates every three seconds.

## AT Protocol details

- Each move and join is an AT Protocol record in collection `games.connectfour.move`.
- Each player writes only to their own repository using `com.atproto.repo.createRecord`.
- The server reads both repositories with `com.atproto.repo.listRecords`, validates moves, and deterministically replays them into a board.
- The server holds temporary in-memory login sessions and room guest registration. Restarting the server loses this matchmaking state, though published moves remain on AT Protocol.
- Game moves and player DIDs are **public records**.
- This prototype assumes accounts are on `bsky.social`; custom PDS service discovery and persistent matchmaking are future improvements.
- Polling a full repository collection every 3 seconds is intentionally simple, not production-efficient. A production system should index records via the firehose or maintain a cache.
- For concurrent writes and cheating prevention, an authoritative validator and stronger move ordering would be needed.

## Security

Run locally or on a trusted HTTPS host. App passwords are handled server-side in memory, never persisted. This is a prototype, not a production authentication service. It does not implement OAuth, CSRF protection, or persistent sessions. Don't expose the demo server publicly without hardening it.
