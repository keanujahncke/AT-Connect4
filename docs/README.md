# AT Connect Four

A multiplayer Connect Four game built using the **AT Protocol (atproto)**.

Players can compete from different devices using their Bluesky accounts. Game invitations, player confirmations, and moves are stored in each player's AT Protocol repository rather than a centralized application database.

The application runs entirely in the browser and can be hosted as a static website using GitHub Pages.

## Playing

1. Both players open the website and sign in using **separate Bluesky accounts** and dedicated **app passwords**.
    - Short usernames such as `thomas` are automatically expanded to `thomas.bsky.social`.
    - Custom domain handles such as `thomas.dev` must be entered in full.
2. The host selects **Create match**, copies the generated **invite code**, and sends it to the other player.
3. The guest enters the invite code, selects **Join match**, and sends the resulting **acceptance code** back to the host.
4. The host enters the acceptance code and selects **Confirm opponent**.
5. The game begins. The host plays **Red** and moves first, while the guest plays **Yellow**.

Both browsers check for new moves approximately every three seconds.

## How It Works

The application uses AT Protocol to exchange game information without a dedicated application server.

### Matchmaking

Each match is identified by the host's decentralized identifier (DID) and a randomly generated 96-bit match ID.

The matchmaking process consists of three records:

1. **Match:** The host publishes a `match` record to their repository.
2. **Join:** The guest publishes a `join` record to their own repository.
3. **Confirm:** The host publishes a `confirm` record identifying the guest.

The invite and acceptance codes allow both players to discover the relevant repositories without relying on a centralized matchmaking service.

### Game State

Each player publishes their moves as records in their own AT Protocol repository, using the `games.connectfour.move` collection.

To reconstruct the game, each browser:

1. Resolves the players' DIDs to their Personal Data Servers (PDSs).
2. Retrieves the relevant records from both repositories.
3. Combines and validates the moves in turn order.
4. Reconstructs the board and checks for a win or draw.

The browsers poll the repositories every three seconds to detect new moves.

**No application-owned backend or database is required.** The application still depends on AT Protocol infrastructure to authenticate users and store records.

## Project Structure

The static website consists of:

- `index.html` — Website structure and game interface.
- `style.css` — Styling and layout.
- `app.js` — Authentication, AT Protocol communication, matchmaking, game logic, and synchronization.

## Important Limitations

This project is a functional prototype and is not intended for production use.

- **Authentication:** Players authenticate using dedicated Bluesky app passwords. Credentials are sent directly from the browser to `bsky.social`, and session tokens are kept in memory rather than persistent browser storage. Refreshing the page signs the user out. Never use your main Bluesky password. AT Protocol OAuth would be preferable for a production application.
- **Account providers:** Authentication currently uses Bluesky's `bsky.social` entry point. Accounts hosted by independent AT Protocol providers may require additional login handling.
- **Browser compatibility:** The application depends on cross-origin requests being permitted by the relevant AT Protocol servers and DID resolvers.
- **Matchmaking:** The two-code invitation process is necessary because the host cannot automatically discover a join record stored in an unknown guest's repository.
- **Public records:** Game records are publicly readable, including match history and moves.
- **Security and concurrency:** The prototype is not hardened against malicious record injection, conflicting moves, or race conditions. The first successful confirmation record determines the opponent.
- **Performance:** The application polls up to 2,000 records per player per refresh, which may become inefficient as record histories grow.
- **Session persistence:** Authentication sessions and the active match are not preserved across page reloads. Players should save their invite codes if they want to resume a match.

## Testing Locally

The project can be run using any static HTTP server.

For example, using Python:

```bash
python -m http.server 8000
```

Then open:

`http://localhost:8000`

Alternatively, open the deployed GitHub Pages website.

Two separate Bluesky accounts are required to test multiplayer gameplay.