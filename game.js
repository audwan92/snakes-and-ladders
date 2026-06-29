const board = document.querySelector("#board");
const pathLayer = document.querySelector("#path-layer");
const setupScreen = document.querySelector("#setup-screen");
const gameScreen = document.querySelector("#game-screen");
const winScreen = document.querySelector("#win-screen");
const setupForm = document.querySelector("#setup-form");
const lobbyNameInput = document.querySelector("#lobby-name");
const lobbyColorInput = document.querySelector("#lobby-color");
const lobbyList = document.querySelector("#lobby-list");
const readyButton = document.querySelector("#ready-button");
const dice = document.querySelector("#dice");
const diceValue = document.querySelector("#dice-value");
const playerList = document.querySelector("#player-list");
const eventToast = document.querySelector("#event-toast");
const playAgainButton = document.querySelector("#play-again-button");
const winMenuButton = document.querySelector("#win-menu-button");
const winnerToken = document.querySelector("#winner-token");
const winnerTitle = document.querySelector("#winner-title");
const winnerMessage = document.querySelector("#winner-message");
const clientId = getClientId();
const remote = {
  enabled: false,
  applying: false,
  mode: "none",
  events: null,
  pollTimer: null,
  lastEventId: 0,
  lobby: [],
  settings: {
    extraTurn: false,
    startOutside: false,
  },
};

const squareColors = ["#FFF3D6", "#FFE082", "#C8E6C9", "#BBDEFB", "#FFCC80"];
const tokenPalette = ["#E53935", "#1E88E5", "#43A047", "#8E24AA"];
const ladders = new Map([
  [4, 14],
  [9, 31],
  [20, 38],
  [28, 84],
  [40, 59],
  [51, 67],
  [63, 81],
  [71, 91],
]);
const snakes = new Map([
  [17, 7],
  [54, 34],
  [62, 19],
  [64, 60],
  [87, 24],
  [93, 73],
  [95, 75],
  [99, 78],
]);

let state = createDefaultState();

function createDefaultState() {
  return {
    players: [],
    currentPlayerIndex: 0,
    diceValue: 1,
    exactWin: true,
    extraTurn: false,
    startOutside: false,
    rolling: false,
    gameStatus: "setup",
    turnNumber: 1,
  };
}

function makeSquareMap() {
  const map = new Map();
  for (let square = 1; square <= 100; square++) {
    const zero = square - 1;
    const rowFromBottom = Math.floor(zero / 10);
    const colInRow = zero % 10;
    const col = rowFromBottom % 2 === 0 ? colInRow : 9 - colInRow;
    const row = 9 - rowFromBottom;
    map.set(square, { row, col });
  }
  return map;
}

const squareMap = makeSquareMap();

function initLobbyForm() {
  lobbyNameInput.value = localStorage.getItem("snakes-ladders-name") || "Player";
  lobbyColorInput.value = localStorage.getItem("snakes-ladders-color") || tokenPalette[Math.floor(Math.random() * tokenPalette.length)];
}

function saveLobbyPrefs() {
  localStorage.setItem("snakes-ladders-name", lobbyNameInput.value.trim() || "Player");
  localStorage.setItem("snakes-ladders-color", lobbyColorInput.value);
}

function renderLobby() {
  if (!lobbyList) return;

  const me = remote.lobby.find((player) => player.clientId === clientId);
  const allReady = remote.lobby.length >= 2 && remote.lobby.every((player) => player.ready);
  lobbyList.innerHTML = "";

  remote.lobby.forEach((player) => {
    const row = document.createElement("div");
    row.className = `lobby-player${player.ready ? " ready" : ""}${player.clientId === clientId ? " mine" : ""}`;

    const token = document.createElement("span");
    token.className = "mini-token";
    token.style.background = player.color;

    const name = document.createElement("strong");
    name.textContent = player.name;

    const status = document.createElement("span");
    status.className = "lobby-status";
    status.textContent = player.ready ? "Ready" : "Not ready";

    row.append(token, name, status);
    lobbyList.append(row);
  });

  if (remote.lobby.length === 0) {
    const empty = document.createElement("div");
    empty.className = "lobby-empty";
    empty.textContent = "Waiting for players to connect...";
    lobbyList.append(empty);
  }

  readyButton.textContent = me?.ready ? "Ready - waiting" : "Ready";
  readyButton.disabled = Boolean(me?.ready || allReady);
}

function renderBoard() {
  board.querySelectorAll(".square").forEach((square) => square.remove());

  for (let visualIndex = 0; visualIndex < 100; visualIndex++) {
    const row = Math.floor(visualIndex / 10);
    const col = visualIndex % 10;
    const squareNumber = [...squareMap.entries()].find(([, pos]) => pos.row === row && pos.col === col)[0];
    const square = document.createElement("div");
    square.className = "square";
    square.dataset.square = squareNumber;
    square.style.background = squareColors[(row + col) % squareColors.length];
    if (ladders.has(squareNumber)) square.classList.add("special-ladder");
    if (snakes.has(squareNumber)) square.classList.add("special-snake");
    if (squareNumber === 100) square.classList.add("finish-square");

    const number = document.createElement("span");
    number.className = "square-number";
    number.textContent = squareNumber;

    const tokens = document.createElement("div");
    tokens.className = "tokens";

    square.append(number, tokens);
    board.append(square);
  }

  drawPaths();
}

function pointForSquare(square) {
  const { row, col } = squareMap.get(square);
  return {
    x: col * 100 + 50,
    y: row * 100 + 50,
  };
}

function drawPaths() {
  pathLayer.innerHTML = "";
  ladders.forEach((to, from) => drawLadder(from, to));
  snakes.forEach((to, from) => drawSnake(from, to));
}

function drawLadder(from, to) {
  const start = pointForSquare(from);
  const end = pointForSquare(to);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy) || 1;
  const offsetX = (-dy / length) * 18;
  const offsetY = (dx / length) * 18;

  const glow = svgLine(start.x, start.y, end.x, end.y, "ladder-glow");
  const sideA = svgLine(start.x + offsetX, start.y + offsetY, end.x + offsetX, end.y + offsetY, "ladder-side");
  const sideB = svgLine(start.x - offsetX, start.y - offsetY, end.x - offsetX, end.y - offsetY, "ladder-side");
  pathLayer.append(glow, sideA, sideB);

  for (let step = 0.18; step < 0.88; step += 0.16) {
    const x = start.x + dx * step;
    const y = start.y + dy * step;
    pathLayer.append(svgLine(x + offsetX, y + offsetY, x - offsetX, y - offsetY, "ladder-rung"));
  }
}

function drawSnake(from, to) {
  const start = pointForSquare(from);
  const end = pointForSquare(to);
  const controlX = (start.x + end.x) / 2 + (start.y - end.y) * 0.18;
  const controlY = (start.y + end.y) / 2 + (end.x - start.x) * 0.18;
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("class", "snake-body");
  path.setAttribute("d", `M ${start.x} ${start.y} Q ${controlX} ${controlY} ${end.x} ${end.y}`);

  const belly = document.createElementNS("http://www.w3.org/2000/svg", "path");
  belly.setAttribute("class", "snake-belly");
  belly.setAttribute("d", `M ${start.x} ${start.y} Q ${controlX} ${controlY} ${end.x} ${end.y}`);

  const head = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  head.setAttribute("class", "snake-head");
  head.setAttribute("cx", start.x);
  head.setAttribute("cy", start.y);
  head.setAttribute("r", 20);

  const eyeA = svgCircle(start.x - 7, start.y - 6, 4, "snake-eye");
  const eyeB = svgCircle(start.x + 7, start.y - 6, 4, "snake-eye");
  const tongue = svgLine(start.x, start.y + 18, start.x, start.y + 36, "snake-tongue");
  pathLayer.append(path, belly, head, eyeA, eyeB, tongue);
}

function svgLine(x1, y1, x2, y2, className) {
  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("x1", x1);
  line.setAttribute("y1", y1);
  line.setAttribute("x2", x2);
  line.setAttribute("y2", y2);
  line.setAttribute("class", className);
  return line;
}

function svgCircle(cx, cy, r, className) {
  const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  circle.setAttribute("cx", cx);
  circle.setAttribute("cy", cy);
  circle.setAttribute("r", r);
  circle.setAttribute("class", className);
  return circle;
}

function startGame(event) {
  event.preventDefault();
  if (remote.enabled && !remote.applying) {
    remoteLobbyUpdate(true);
    return;
  }

  showEvent("Start the multiplayer server first.", "snake");
}

function updateGameView() {
  renderTokens();
  renderPlayerList();
  renderDice(state.diceValue);
}

function renderDice(value) {
  const pipMap = {
    1: [4],
    2: [0, 8],
    3: [0, 4, 8],
    4: [0, 2, 6, 8],
    5: [0, 2, 4, 6, 8],
    6: [0, 2, 3, 5, 6, 8],
  };
  diceValue.className = "dice-face";
  diceValue.textContent = "";
  for (let index = 0; index < 9; index++) {
    const cell = document.createElement("span");
    if (pipMap[value].includes(index)) cell.className = "pip";
    diceValue.append(cell);
  }
}

function renderTokens() {
  board.querySelectorAll(".tokens").forEach((slot) => {
    slot.innerHTML = "";
  });

  state.players.forEach((player) => {
    if (player.position < 1) return;
    const square = board.querySelector(`[data-square="${player.position}"] .tokens`);
    if (!square) return;
    const token = document.createElement("div");
    token.className = "token";
    token.style.background = player.color;
    token.textContent = player.id;
    token.title = `${player.name} on square ${player.position}`;
    square.append(token);
  });
}

function renderPlayerList() {
  playerList.innerHTML = "";
  state.players.forEach((player, index) => {
    const card = document.createElement("div");
    card.className = `player-card${index === state.currentPlayerIndex ? " active" : ""}${player.ownerClientId ? " claimed" : ""}${player.ownerClientId === clientId ? " mine" : ""}`;
    card.dataset.playerId = player.id;
    card.title = player.ownerClientId === clientId ? "This is your player" : "Tap to play as this player";

    const token = document.createElement("span");
    token.className = "mini-token";
    token.style.background = player.color;

    const meta = document.createElement("div");
    meta.className = "player-meta";

    const name = document.createElement("strong");
    name.textContent = player.name;

    const progressTrack = document.createElement("div");
    progressTrack.className = "hidden";
    const progressFill = document.createElement("div");
    progressFill.className = "progress-fill";
    progressFill.style.width = `${Math.max(player.position, 0)}%`;
    progressFill.style.color = player.color;
    progressTrack.append(progressFill);

    const position = document.createElement("span");
    position.className = "position-label";
    position.textContent = player.position ? `#${player.position}` : "Start";

    meta.append(name, progressTrack);
    card.append(token, meta, position);
    card.addEventListener("click", (event) => {
      event.stopPropagation();
      if (remote.enabled) {
        remoteClaim(player.id);
      }
    });
    playerList.append(card);
  });
}

function setMessage(text) {
  showEvent(text);
}

function showEvent(text, type = "bonus") {
  eventToast.textContent = text;
  eventToast.className = `event-toast ${type}`;
  window.clearTimeout(showEvent.timer);
  showEvent.timer = window.setTimeout(() => {
    eventToast.classList.add("hidden");
  }, 1150);
}

async function rollDice() {
  if (state.rolling || state.gameStatus !== "playing") return;
  if (remote.enabled && !remote.applying) {
    await remoteRoll();
    return;
  }

  state.rolling = true;
  dice.classList.remove("hidden");
  dice.classList.add("rolling");
  eventToast.classList.add("hidden");

  const rolled = Math.floor(Math.random() * 6) + 1;
  for (let tick = 0; tick < 8; tick++) {
    renderDice(Math.floor(Math.random() * 6) + 1);
    await wait(65);
  }
  state.diceValue = rolled;
  renderDice(rolled);
  dice.classList.remove("rolling");
  await wait(600);
  dice.classList.add("hidden");
  showEvent(`${state.players[state.currentPlayerIndex].name} rolled ${rolled}`, rolled === 6 ? "bonus" : "");

  await handleMove(rolled);

  state.rolling = false;
  updateGameView();
}

async function handleMove(rolled) {
  const player = state.players[state.currentPlayerIndex];
  setMessage(`${player.name} rolled ${rolled}`);
  await wait(360);

  if (state.startOutside && player.position === 0) {
    if (rolled === 1 || rolled === 6) {
      player.position = 1;
      showEvent(`${player.name} joined the race`, "bonus");
      updateGameView();
      await wait(420);
    } else {
      setMessage(`${player.name} needs 1 or 6 to enter.`);
      showEvent("Gate locked. Try for 1 or 6.", "snake");
      advanceTurn(rolled);
      return;
    }
  } else {
    const target = player.position + rolled;
    if (target > 100) {
      setMessage("You need exact number to finish.");
      showEvent("Exact finish needed", "bonus");
      advanceTurn(rolled);
      return;
    }

    while (player.position < target) {
      player.position += 1;
      updateGameView();
      await wait(150);
    }
  }

  if (player.position === 100) {
    showWinner(player);
    return;
  }

  if (ladders.has(player.position)) {
    const destination = ladders.get(player.position);
    showEvent(`Ladder boost to ${destination}`, "ladder");
    await moveDirectly(player, destination);
  } else if (snakes.has(player.position)) {
    const destination = snakes.get(player.position);
    showEvent(`Slide down to ${destination}`, "snake");
    await moveDirectly(player, destination);
  }

  if (player.position === 100) {
    showWinner(player);
    return;
  }

  advanceTurn(rolled);
}

async function moveDirectly(player, destination) {
  await wait(520);
  player.position = destination;
  updateGameView();
  await wait(520);
}

function advanceTurn(rolled) {
  if (state.extraTurn && rolled === 6) {
    const player = state.players[state.currentPlayerIndex];
    showEvent("Bonus turn unlocked", "bonus");
    return;
  }
  state.currentPlayerIndex = (state.currentPlayerIndex + 1) % state.players.length;
  state.turnNumber += 1;
  const next = state.players[state.currentPlayerIndex];
  showEvent(`${next.name} turn`);
}

function showWinner(player) {
  player.isWinner = true;
  state.gameStatus = "won";
  gameScreen.classList.add("hidden");
  winScreen.classList.remove("hidden");
  winnerToken.textContent = player.id;
  winnerToken.style.background = player.color;
  winnerTitle.textContent = `${player.name} wins!`;
  winnerMessage.textContent = `Congratulations ${player.name}! You reached square 100 and won the game.`;
  launchConfetti();
}

function launchConfetti() {
  const colors = ["#E53935", "#1E88E5", "#43A047", "#8E24AA", "#F6B333", "#146C94"];
  for (let index = 0; index < 54; index++) {
    const piece = document.createElement("span");
    piece.className = "confetti";
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = colors[index % colors.length];
    piece.style.animationDelay = `${Math.random() * 0.7}s`;
    document.body.append(piece);
    setTimeout(() => piece.remove(), 2600);
  }
}

function restartGame() {
  if (remote.enabled && !remote.applying) {
    remoteStartFromCurrentPlayers();
    return;
  }

  state.players = state.players.map((player) => ({
    ...player,
    position: state.startOutside ? 0 : 1,
    isWinner: false,
  }));
  state.currentPlayerIndex = 0;
  state.diceValue = 1;
  state.gameStatus = "playing";
  state.turnNumber = 1;
  eventToast.classList.add("hidden");
  dice.classList.add("hidden");
  winScreen.classList.add("hidden");
  gameScreen.classList.remove("hidden");
  updateGameView();
  showEvent(`${state.players[0].name} turn`);
}

function backToMenu() {
  if (remote.enabled && !remote.applying) {
    remoteMenu();
    return;
  }

  state = createDefaultState();
  gameScreen.classList.add("hidden");
  winScreen.classList.add("hidden");
  setupScreen.classList.remove("hidden");
  renderLobby();
}

function getClientId() {
  const key = "snakes-ladders-client-id";
  let value = localStorage.getItem(key);
  if (!value) {
    value = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(key, value);
  }
  return value;
}

async function initRemoteMode() {
  if (!location.protocol.startsWith("http")) return;

  const candidates = [
    { mode: "node", state: "/api/state", events: `/api/events?clientId=${encodeURIComponent(clientId)}` },
    { mode: "php", state: `/api/index.php?action=state&clientId=${encodeURIComponent(clientId)}`, events: null },
  ];

  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate.state, { cache: "no-store" });
      if (!response.ok) continue;
      const payload = await response.json();
      if (!payload || !payload.state) continue;
      remote.enabled = true;
      remote.mode = candidate.mode;
      remote.stateEndpoint = candidate.state;
      remote.eventsEndpoint = candidate.events;
      applyRemotePayload({ ...payload, event: { id: 0, kind: "sync", text: "" } });
      connectRemoteEvents();
      remoteLobbyUpdate(false);
      return;
    } catch {
      remote.enabled = false;
    }
  }
}

function connectRemoteEvents() {
  if (remote.mode === "php") {
    if (remote.pollTimer) return;
    remote.pollTimer = window.setInterval(pollRemoteState, 1000);
    return;
  }

  if (!window.EventSource || remote.events || !remote.eventsEndpoint) return;

  remote.events = new EventSource(remote.eventsEndpoint);
  remote.events.onmessage = (messageEvent) => {
    const payload = JSON.parse(messageEvent.data);
    applyRemotePayload(payload);
  };
}

async function pollRemoteState() {
  if (!remote.stateEndpoint || remote.applying) return;
  try {
    const response = await fetch(remote.stateEndpoint, { cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json();
    applyRemotePayload(payload);
  } catch {
    showEvent("Connection lost", "snake");
  }
}

function apiEndpoint(action) {
  if (remote.mode === "php") return `/api/index.php?action=${encodeURIComponent(action)}`;
  return `/api/${action}`;
}

async function remoteLobbyUpdate(ready) {
  saveLobbyPrefs();
  await postRemote("lobby", {
    clientId,
    name: lobbyNameInput.value.trim() || "Player",
    color: lobbyColorInput.value,
    ready,
    extraTurn: document.querySelector("#extra-turn").checked,
    startOutside: document.querySelector("#start-outside").checked,
  });
}

async function remoteStartFromCurrentPlayers() {
  await remoteMenu();
}

async function remoteRoll() {
  const player = state.players[state.currentPlayerIndex];
  if (player && player.ownerClientId && player.ownerClientId !== clientId) {
    showEvent(`Waiting for ${player.name}'s PC.`, "bonus");
    return;
  }
  if (player && !player.ownerClientId) {
    showEvent(`${player.name} must tap their name first.`, "bonus");
    return;
  }
  await postRemote("roll", { clientId });
}

async function remoteClaim(playerId) {
  await postRemote("claim", { clientId, playerId });
}

async function remoteMenu() {
  await postRemote("menu", { clientId });
}

async function postRemote(action, payload) {
  try {
    const response = await fetch(apiEndpoint(action), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (result.event && result.event.private) {
      showEvent(result.event.text, result.event.kind);
    } else if (result.state) {
      applyRemotePayload(result);
    }
  } catch {
    showEvent("Connection lost", "snake");
  }
}

function applyRemotePayload(payload) {
  remote.lobby = Array.isArray(payload.lobby) ? payload.lobby : remote.lobby;
  remote.settings = payload.settings || remote.settings;
  document.querySelector("#extra-turn").checked = Boolean(remote.settings.extraTurn);
  document.querySelector("#start-outside").checked = Boolean(remote.settings.startOutside);
  renderLobby();
  applyRemoteState(payload.state, payload.event);
}

async function applyRemoteState(nextState, event) {
  if (!nextState) return;

  remote.applying = true;
  state = nextState;

  if (state.gameStatus === "setup") {
    gameScreen.classList.add("hidden");
    winScreen.classList.add("hidden");
    setupScreen.classList.remove("hidden");
    renderLobby();
    eventToast.classList.add("hidden");
    dice.classList.add("hidden");
    remote.applying = false;
    return;
  }

  setupScreen.classList.add("hidden");
  winScreen.classList.add("hidden");
  gameScreen.classList.remove("hidden");
  updateGameView();

  if (event && event.id > remote.lastEventId) {
    remote.lastEventId = event.id;
    if (event.rolled) {
      await playRemoteDice(event.rolled);
    }
    if (event.text) {
      showEvent(event.text, event.kind);
    }
  }

  if (state.gameStatus === "won") {
    const winner = state.players.find((player) => player.isWinner);
    if (winner) showWinner(winner);
  }

  remote.applying = false;
}

async function playRemoteDice(rolled) {
  dice.classList.remove("hidden");
  dice.classList.add("rolling");
  eventToast.classList.add("hidden");

  for (let tick = 0; tick < 8; tick++) {
    renderDice(Math.floor(Math.random() * 6) + 1);
    await wait(55);
  }

  renderDice(rolled);
  dice.classList.remove("rolling");
  await wait(520);
  dice.classList.add("hidden");
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

initLobbyForm();
renderBoard();
initRemoteMode();

setupForm.addEventListener("submit", startGame);
lobbyNameInput.addEventListener("input", () => {
  saveLobbyPrefs();
});
lobbyColorInput.addEventListener("input", () => {
  saveLobbyPrefs();
});
lobbyNameInput.addEventListener("change", () => {
  if (remote.enabled) remoteLobbyUpdate(false);
});
lobbyColorInput.addEventListener("change", () => {
  if (remote.enabled) remoteLobbyUpdate(false);
});
document.querySelector("#extra-turn").addEventListener("change", () => {
  if (remote.enabled) remoteLobbyUpdate(false);
});
document.querySelector("#start-outside").addEventListener("change", () => {
  if (remote.enabled) remoteLobbyUpdate(false);
});
board.addEventListener("click", rollDice);
dice.addEventListener("click", (event) => {
  event.stopPropagation();
  rollDice();
});
playAgainButton.addEventListener("click", restartGame);
winMenuButton.addEventListener("click", backToMenu);
