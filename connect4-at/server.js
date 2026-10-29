
import express from 'express';
import { BskyAgent } from '@atproto/api';
import crypto from 'node:crypto';

const app = express();
app.use(express.json({ limit: '30kb' }));
app.use(express.static('public'));

const sessions = new Map();
const rooms = new Map();
const COLLECTION = 'games.connectfour.move';

const session = (req, res, next) => {
  const s = sessions.get(req.get('x-session'));
  if (!s) {
    return res.status(401).json({ error: 'Sign in first' });
  }
  req.player = s;
  next();
};

const error = (res, e) =>
  res.status(400).json({ error: e?.message || 'Request failed' });

const parseRoom = code => {
  try {
    const r = JSON.parse(
      Buffer.from(code, 'base64url').toString()
    );

    if (
      typeof r.host !== 'string' ||
      typeof r.id !== 'string' ||
      !/^did:[a-z0-9]+:[a-zA-Z0-9._:%-]+$/.test(r.host) ||
      !/^[a-f0-9]{24}$/.test(r.id)
    ) {
      throw Error();
    }

    return r;
  } catch {
    throw Error('Invalid room code');
  }
};

const roomCode = r =>
  Buffer.from(JSON.stringify(r)).toString('base64url');

// Resolve the PDS hosting each player's repository.
const pdsCache = new Map();

async function pdsFor(did) {
  if (pdsCache.has(did)) {
    return pdsCache.get(did);
  }

  let url;

  if (did.startsWith('did:plc:')) {
    url = `https://plc.directory/${encodeURIComponent(did)}`;
  } else if (did.startsWith('did:web:')) {
    const parts = did.slice(8).split(':').map(decodeURIComponent);

    url = `https://${parts[0]}/${
      parts.length > 1
        ? parts.slice(1).join('/') + '/'
        : '.well-known/'
    }did.json`;
  } else {
    throw Error('Unsupported DID method');
  }

  const response = await fetch(url);

  if (!response.ok) {
    throw Error(`Could not resolve ${did}: HTTP ${response.status}`);
  }

  const doc = await response.json();

  const service = doc.service?.find(
    s =>
      s.id === '#atproto_pds' ||
      s.type === 'AtprotoPersonalDataServer'
  );

  const endpoint = service?.serviceEndpoint;

  if (
    typeof endpoint !== 'string' ||
    !endpoint.startsWith('https://')
  ) {
    throw Error(`No valid PDS endpoint for ${did}`);
  }

  pdsCache.set(did, endpoint);
  return endpoint;
}

async function readMoves(room, guestDid) {
  const dids = [
    room.host,
    ...(
      guestDid && guestDid !== room.host
        ? [guestDid]
        : []
    )
  ];

  const out = [];

  for (const did of dids) {
    const pds = await pdsFor(did);

    let cursor;
    let count = 0;

    do {
      const params = new URLSearchParams({
        repo: did,
        collection: COLLECTION,
        limit: '100'
      });

      if (cursor) {
        params.set('cursor', cursor);
      }

      const response = await fetch(
        `${pds}/xrpc/com.atproto.repo.listRecords?${params}`
      );

      if (!response.ok) {
        const body = await response.text();

        throw Error(
          `Could not read records for ${did} from ${pds}: ` +
          `HTTP ${response.status} ${body.slice(0, 200)}`
        );
      }

      const page = await response.json();

      for (const r of page.records || []) {
        const v = r.value;

        if (
          v.gameId === room.id &&
          (v.type === 'join' || v.type === 'move')
        ) {
          out.push({
            uri: r.uri,
            author: did,
            ...v
          });
        }
      }

      cursor = page.cursor;
    } while (cursor && ++count < 20);
  }

  return out;
}

function replay(room, records) {
  const joins = records
    .filter(r => r.type === 'join' && r.author !== room.host)
    .sort((a, b) => a.uri.localeCompare(b.uri));

  const guest = joins[0]?.author || null;

  const moves = records.filter(r => r.type === 'move');

  const board = Array.from(
    { length: 6 },
    () => Array(7).fill(0)
  );

  const accepted = [];

  let previous = null;
  let winner = 0;

  for (let n = 0; n < 42; n++) {
    const player = n % 2 === 0 ? room.host : guest;

    if (!player || winner) {
      break;
    }

    const choices = moves
      .filter(
        m =>
          m.author === player &&
          m.turn === n &&
          (m.previous || null) === previous &&
          Number.isInteger(m.column) &&
          m.column >= 0 &&
          m.column < 7
      )
      .sort((a, b) => a.uri.localeCompare(b.uri));

    const m = choices.find(
      m => board[0][m.column] === 0
    );

    if (!m) {
      break;
    }

    let row = 5;

    while (row >= 0 && board[row][m.column] !== 0) {
      row--;
    }

    if (row < 0) {
      break;
    }

    const side = (n % 2) + 1;

    board[row][m.column] = side;

    accepted.push({
      ...m,
      row,
      side
    });

    previous = m.uri;

    for (const [dr, dc] of [
      [1, 0],
      [0, 1],
      [1, 1],
      [1, -1]
    ]) {
      let count = 1;

      for (const sign of [-1, 1]) {
        let r = row + dr * sign;
        let c = m.column + dc * sign;

        while (
          r >= 0 &&
          r < 6 &&
          c >= 0 &&
          c < 7 &&
          board[r][c] === side
        ) {
          count++;
          r += dr * sign;
          c += dc * sign;
        }
      }

      if (count >= 4) {
        winner = side;
      }
    }
  }

  return {
    board,
    moves: accepted,
    guest,
    winner,
    draw: accepted.length === 42,
    turn: accepted.length,
    previous
  };
}

// LOGIN
app.post('/api/login', async (req, res) => {
  try {
    let handle = String(req.body.handle || '').trim();
    const { password, service } = req.body;

    if (!handle || !password) {
      throw Error('Handle and app password required');
    }

    // Allow short Bluesky usernames.
    // "kjahncke" becomes "kjahncke.bsky.social".
    // Full handles and custom domains remain unchanged.
    handle = handle.replace(/^@/, '');

    if (
      !handle.includes('.') &&
      !handle.startsWith('did:')
    ) {
      handle += '.bsky.social';
    }

    const agent = new BskyAgent({
      service: service || 'https://bsky.social'
    });

    const result = await agent.login({
      identifier: handle,
      password
    });

    const token = crypto.randomBytes(24).toString('hex');

    sessions.set(token, {
      agent,
      did: result.data.did,
      handle: result.data.handle
    });

    res.json({
      token,
      did: result.data.did,
      handle: result.data.handle
    });
  } catch (e) {
    error(res, e);
  }
});

// CREATE MATCH
app.post('/api/create', session, (req, res) => {
  const room = {
    host: req.player.did,
    id: crypto.randomBytes(12).toString('hex')
  };

  const code = roomCode(room);

  rooms.set(code, {
    host: room.host,
    guest: null
  });

  res.json({ code, room });
});

// GET MATCH STATE
app.get('/api/state', session, async (req, res) => {
  try {
    const room = parseRoom(req.query.code);

    const guestDid =
      rooms.get(req.query.code)?.guest ||
      (
        req.player.did !== room.host
          ? req.player.did
          : null
      );

    const records = await readMoves(room, guestDid);
    const state = replay(room, records);

    res.json({
      ...state,
      host: room.host,
      you: req.player.did,
      code: req.query.code
    });
  } catch (e) {
    error(res, e);
  }
});

// JOIN MATCH
app.post('/api/join', session, async (req, res) => {
  try {
    const room = parseRoom(req.body.code);

    if (req.player.did === room.host) {
      throw Error('Host cannot join as guest');
    }

    const existing = rooms.get(req.body.code);

    if (!existing) {
      throw Error('Room not found on this server');
    }

    const records = await readMoves(
      room,
      existing.guest || req.player.did
    );

    const state = replay(room, records);

    if (
      state.guest &&
      state.guest !== req.player.did
    ) {
      throw Error('Room already has a second player');
    }

    if (!state.guest) {
      await req.player.agent.com.atproto.repo.createRecord({
        repo: req.player.did,
        collection: COLLECTION,
        record: {
          $type: COLLECTION,
          type: 'join',
          gameId: room.id,
          host: room.host,
          createdAt: new Date().toISOString()
        }
      });
    }

    existing.guest = req.player.did;

    res.json({ ok: true });
  } catch (e) {
    error(res, e);
  }
});

// MAKE MOVE
app.post('/api/move', session, async (req, res) => {
  try {
    const room = parseRoom(req.body.code);
    const col = req.body.column;

    if (
      !Number.isInteger(col) ||
      col < 0 ||
      col > 6
    ) {
      throw Error('Invalid column');
    }

    const records = await readMoves(
      room,
      rooms.get(req.body.code)?.guest
    );

    const state = replay(room, records);

    if (!state.guest) {
      throw Error('Waiting for second player');
    }

    if (state.winner || state.draw) {
      throw Error('Match finished');
    }

    const currentPlayer =
      state.turn % 2 === 0
        ? room.host
        : state.guest;

    if (currentPlayer !== req.player.did) {
      throw Error('Not your turn');
    }

    if (state.board[0][col]) {
      throw Error('Column full');
    }

    const result =
      await req.player.agent.com.atproto.repo.createRecord({
        repo: req.player.did,
        collection: COLLECTION,
        record: {
          $type: COLLECTION,
          type: 'move',
          gameId: room.id,
          turn: state.turn,
          column: col,
          previous: state.previous,
          createdAt: new Date().toISOString()
        }
      });

    res.json({
      ok: true,
      uri: result.data.uri
    });
  } catch (e) {
    error(res, e);
  }
});

const port = Number(process.env.PORT) || 3000;

app.listen(port, () => {
  console.log(`Connect Four: http://localhost:${port}`);
});
