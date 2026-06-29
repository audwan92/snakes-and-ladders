const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 4173);
const root = __dirname;
const ladders = new Map([[4, 14], [9, 31], [20, 38], [28, 84], [40, 59], [51, 67], [63, 81], [71, 91]]);
const snakes = new Map([[17, 7], [54, 34], [62, 19], [64, 60], [87, 24], [93, 73], [95, 75], [99, 78]]);

let clients = [];
let eventId = 0;
let state = createDefaultState();
let lobby = new Map();
let lobbySettings = {
  extraTurn: false,
  startOutside: false,
};

function createDefaultState() {
  return {
    players: [],
    currentPlayerIndex: 0,
    diceValue: 1,
    exactWin: true,
    extraTurn: false,
    startOutside: false,
    gameStatus: "setup",
    turnNumber: 1,
  };
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function nextEvent(kind, text, extra = {}) {
  return { id: ++eventId, kind, text, createdAt: Date.now(), ...extra };
}

function broadcast(event) {
  const payload = JSON.stringify({ state, lobby: lobbySnapshot(), settings: lobbySettings, event });
  clients = clients.filter((client) => !client.res.destroyed);
  clients.forEach((client) => {
    client.res.write(`id: ${event.id}\n`);
    client.res.write(`data: ${payload}\n\n`);
  });
}

function lobbySnapshot() {
  const activeClientIds = new Set(clients.map((client) => client.clientId).filter(Boolean));
  return [...lobby.values()]
    .filter((player) => activeClientIds.has(player.clientId))
    .sort((a, b) => a.joinedAt - b.joinedAt)
    .map((player, index) => ({
      id: index + 1,
      clientId: player.clientId,
      name: player.name,
      color: player.color,
      ready: player.ready,
      connected: true,
    }));
}

function ensureLobbyPlayer(clientId) {
  if (!clientId) return null;
  const palette = ["#E53935", "#1E88E5", "#43A047", "#8E24AA"];
  let player = lobby.get(clientId);

  if (!player) {
    player = {
      clientId,
      name: `Player ${Math.min(lobby.size + 1, 4)}`,
      color: palette[lobby.size % palette.length],
      ready: false,
      connected: true,
      joinedAt: Date.now(),
    };
    lobby.set(clientId, player);
  }

  player.connected = true;
  return player;
}

function updateLobby(payload) {
  const clientId = String(payload.clientId || "");
  const player = ensureLobbyPlayer(clientId);

  if (!player) {
    return nextEvent("idle", "Could not join lobby.", { private: true });
  }

  player.name = String(payload.name || player.name || "Player").trim().slice(0, 18) || "Player";
  player.color = /^#[0-9a-f]{6}$/i.test(payload.color) ? payload.color : player.color;
  player.ready = Boolean(payload.ready);

  if (typeof payload.extraTurn === "boolean") lobbySettings.extraTurn = payload.extraTurn;
  if (typeof payload.startOutside === "boolean") lobbySettings.startOutside = payload.startOutside;

  const startEvent = maybeStartFromLobby();
  if (startEvent) return startEvent;

  return nextEvent("lobby", player.ready ? `${player.name} is ready` : `${player.name} is editing`);
}

function maybeStartFromLobby() {
  const readyPlayers = lobbySnapshot();
  if (state.gameStatus !== "setup") return null;
  if (readyPlayers.length < 2) return null;
  if (!readyPlayers.every((player) => player.ready)) return null;
  return startGameFromPlayers(readyPlayers);
}

function startGameFromPlayers(incomingPlayers) {
  const players = incomingPlayers.slice(0, 4).map((player, index) => ({
    id: index + 1,
    name: String(player.name || `Player ${index + 1}`).slice(0, 18),
    color: /^#[0-9a-f]{6}$/i.test(player.color) ? player.color : ["#E53935", "#1E88E5", "#43A047", "#8E24AA"][index],
    position: lobbySettings.startOutside ? 0 : 1,
    isWinner: false,
    ownerClientId: player.clientId,
  }));

  if (players.length < 2) throw new Error("At least two players are required.");

  state = {
    ...createDefaultState(),
    players,
    extraTurn: lobbySettings.extraTurn,
    startOutside: lobbySettings.startOutside,
    gameStatus: "playing",
  };
  return nextEvent("start", `${state.players[0].name} turn`);
}

function claimPlayer(payload) {
  if (state.gameStatus !== "playing") {
    return { event: nextEvent("idle", "Start a game first.", { private: true }), broadcast: false };
  }

  const clientId = String(payload.clientId || "");
  const playerId = Number(payload.playerId);
  const player = state.players.find((item) => item.id === playerId);

  if (!clientId || !player) {
    return { event: nextEvent("idle", "Choose a player name at the top.", { private: true }), broadcast: false };
  }

  if (player.ownerClientId && player.ownerClientId !== clientId) {
    return { event: nextEvent("idle", `${player.name} is already on another PC.`, { private: true }), broadcast: false };
  }

  player.ownerClientId = clientId;
  return { event: nextEvent("claim", `${player.name} joined this PC`, { playerId: player.id }), broadcast: true };
}

function rollDice(payload = {}) {
  if (state.gameStatus !== "playing" || state.players.length === 0) {
    return { event: nextEvent("idle", "Start a game first.", { private: true }), broadcast: false };
  }

  const player = state.players[state.currentPlayerIndex];
  const clientId = String(payload.clientId || "");

  if (!player.ownerClientId) {
    return { event: nextEvent("idle", `${player.name} must tap their name first.`, { private: true }), broadcast: false };
  }

  if (player.ownerClientId !== clientId) {
    return { event: nextEvent("idle", `Waiting for ${player.name}'s PC.`, { private: true }), broadcast: false };
  }

  const rolled = Math.floor(Math.random() * 6) + 1;
  state.diceValue = rolled;
  let text = `${player.name} rolled ${rolled}`;
  let kind = rolled === 6 ? "bonus" : "roll";

  if (state.startOutside && player.position === 0) {
    if (rolled === 1 || rolled === 6) {
      player.position = 1;
      text = `${player.name} joined the race`;
      kind = "bonus";
    } else {
      advanceTurn();
      return { event: nextEvent("snake", "Gate locked. Try for 1 or 6.", { rolled, playerId: player.id }), broadcast: true };
    }
  } else {
    const target = player.position + rolled;
    if (target > 100) {
      advanceTurn();
      return { event: nextEvent("bonus", "Exact finish needed", { rolled, playerId: player.id }), broadcast: true };
    }
    player.position = target;
  }

  if (player.position === 100) {
    player.isWinner = true;
    state.gameStatus = "won";
    return { event: nextEvent("win", `${player.name} wins!`, { rolled, playerId: player.id }), broadcast: true };
  }

  if (ladders.has(player.position)) {
    const destination = ladders.get(player.position);
    player.position = destination;
    text = `Ladder boost to ${destination}`;
    kind = "ladder";
  } else if (snakes.has(player.position)) {
    const destination = snakes.get(player.position);
    player.position = destination;
    text = `Slide down to ${destination}`;
    kind = "snake";
  }

  if (player.position === 100) {
    player.isWinner = true;
    state.gameStatus = "won";
    return { event: nextEvent("win", `${player.name} wins!`, { rolled, playerId: player.id }), broadcast: true };
  }

  if (state.extraTurn && rolled === 6) {
    if (kind === "roll") {
      text = "Bonus turn unlocked";
      kind = "bonus";
    }
  } else {
    advanceTurn();
  }

  return { event: nextEvent(kind, text, { rolled, playerId: player.id }), broadcast: true };
}

function advanceTurn() {
  state.currentPlayerIndex = (state.currentPlayerIndex + 1) % state.players.length;
  state.turnNumber += 1;
}

function serveStatic(req, res) {
  const urlPath = new URL(req.url, `http://${req.headers.host}`).pathname;
  const requestedPath = urlPath === "/" ? "/index.html" : urlPath;
  const filePath = path.normalize(path.join(root, requestedPath));

  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
    res.writeHead(200, {
      "Content-Type": types[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === "GET" && url.pathname === "/api/state") {
      sendJson(res, 200, { state, lobby: lobbySnapshot(), settings: lobbySettings });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/events") {
      const clientId = String(url.searchParams.get("clientId") || "");
      const lobbyPlayer = ensureLobbyPlayer(clientId);
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });
      res.write(`data: ${JSON.stringify({ state, lobby: lobbySnapshot(), settings: lobbySettings, event: nextEvent("sync", "") })}\n\n`);
      clients.push({ res, clientId });
      if (lobbyPlayer && state.gameStatus === "setup") {
        broadcast(nextEvent("lobby", `${lobbyPlayer.name} joined the lobby`));
      }
      req.on("close", () => {
        clients = clients.filter((client) => client.res !== res);
        if (lobbyPlayer && state.gameStatus === "setup") {
          lobbyPlayer.connected = false;
          lobbyPlayer.ready = false;
          broadcast(nextEvent("lobby", `${lobbyPlayer.name} left the lobby`));
        }
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/start") {
      const payload = await readJson(req);
      const event = startGameFromPlayers(Array.isArray(payload.players) ? payload.players : lobbySnapshot());
      broadcast(event);
      sendJson(res, 200, { state, event });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/lobby") {
      const event = updateLobby(await readJson(req));
      broadcast(event);
      sendJson(res, 200, { state, lobby: lobbySnapshot(), settings: lobbySettings, event });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/claim") {
      const result = claimPlayer(await readJson(req));
      if (result.broadcast) broadcast(result.event);
      sendJson(res, 200, { state, event: result.event });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/roll") {
      const result = rollDice(await readJson(req));
      if (result.broadcast) broadcast(result.event);
      sendJson(res, 200, { state, event: result.event });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/menu") {
      state = createDefaultState();
      lobby.forEach((player) => {
        player.ready = false;
      });
      const event = nextEvent("menu", "");
      broadcast(event);
      sendJson(res, 200, { state, lobby: lobbySnapshot(), settings: lobbySettings, event });
      return;
    }
    serveStatic(req, res);
  } catch (error) {
    sendJson(res, 400, { error: error.message });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Snakes and Ladders multiplayer server running on http://localhost:${PORT}`);
});
