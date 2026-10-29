# AT Connect Four — GitHub Pages edition

Static HTML, CSS, and JavaScript. No Node.js, build step, backend, or database.

## Publish to GitHub Pages

1. Create a GitHub repository (for example `connect4-at`).
2. Upload **index.html**, **app.js**, **style.css** and this README to the repository root.
3. Go to **Settings → Pages → Build and deployment → Deploy from a branch**.
4. Choose `main` and `/ (root)`, then **Save**.
5. Open the URL GitHub Pages provides (usually `https://USERNAME.github.io/REPOSITORY/`).

## Playing

1. Both players visit the website and sign in with **separate Bluesky accounts** and dedicated **app passwords**. Short handles like `kjahncke` work.
2. Host selects **Create match**, then **Copy invite code** and sends it to the guest.
3. Guest pastes invite code, selects **Join match**, then sends the resulting **acceptance code** back to the host.
4. Host pastes acceptance code and selects **Confirm opponent**.
5. Both players' browsers poll their respective AT Protocol repositories every three seconds. The host is Red and moves first.

## How it works

- Each game is identified by the host DID and a random 96-bit match ID encoded in the invite code.
- The host writes a `match` record to their repository. The guest writes a `join` record to their own repository. The host writes a `confirm` record to their own repository, allowing both browsers to discover the two players without a shared server.
- Each move is a `games.connectfour.move` record in the player's own repository. The game state is reconstructed by replaying valid moves.
- No app-owned backend stores matches or moves. AT Protocol PDS infrastructure is still used.

## Important limitations

- **Prototype authentication:** App passwords are entered in the browser and submitted directly to `https://bsky.social` to create a session. Tokens remain in memory only (not localStorage), and refreshing the page signs you out. Use a **dedicated revocable app password**; never use your main password. AT Protocol OAuth is recommended for a production site.
- Sign-in currently targets Bluesky's `bsky.social` entrypoint; other independent PDS account providers may require different login handling. The app resolves repository PDSs separately for record reads/writes.
- Browser CORS policies must permit requests to the account server, DID resolver, and players' PDSs. If a PDS blocks browser requests, a pure-static frontend cannot bypass that restriction.
- The host/guest two-code handshake is necessary because a host cannot automatically discover arbitrary join records written to an unknown guest's repository.
- Records are publicly readable, including game history. The prototype is not hardened against malicious record injection, race conditions, or large record histories.
- The first successful confirmation record in the host's repository determines the opponent. Invite codes should be treated as shareable, not secret credentials.
- The app polls up to 2,000 records per player per refresh; large account histories can make it slow.
- The app does not currently persist the active match code across reloads; save your invite code if you want to resume.

## Testing

Open `index.html` using a static file server or the GitHub Pages URL. A static HTTP server is preferred over `file://` for browser compatibility. Two different accounts are needed for multiplayer.
