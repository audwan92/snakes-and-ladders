<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$stateFile = __DIR__ . '/state.json';
$lockFile = __DIR__ . '/state.lock';
$ladders = [4 => 14, 9 => 31, 20 => 38, 28 => 84, 40 => 59, 51 => 67, 63 => 81, 71 => 91];
$snakes = [17 => 7, 54 => 34, 62 => 19, 64 => 60, 87 => 24, 93 => 73, 95 => 75, 99 => 78];
$palette = ['#E53935', '#1E88E5', '#43A047', '#8E24AA'];

function default_game_state(): array {
    return [
        'players' => [],
        'currentPlayerIndex' => 0,
        'diceValue' => 1,
        'exactWin' => true,
        'extraTurn' => false,
        'startOutside' => false,
        'gameStatus' => 'setup',
        'turnNumber' => 1,
    ];
}

function default_store(): array {
    return [
        'state' => default_game_state(),
        'lobby' => [],
        'settings' => ['extraTurn' => false, 'startOutside' => false],
        'eventId' => 0,
        'event' => ['id' => 0, 'kind' => 'sync', 'text' => '', 'createdAt' => time() * 1000],
    ];
}

function read_json_body(): array {
    $raw = file_get_contents('php://input') ?: '';
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function normalize_color(?string $color, string $fallback): string {
    return preg_match('/^#[0-9a-f]{6}$/i', (string)$color) ? (string)$color : $fallback;
}

function next_event(array &$store, string $kind, string $text, array $extra = []): array {
    $store['eventId'] = (int)($store['eventId'] ?? 0) + 1;
    $event = array_merge([
        'id' => $store['eventId'],
        'kind' => $kind,
        'text' => $text,
        'createdAt' => (int)floor(microtime(true) * 1000),
    ], $extra);
    $store['event'] = $event;
    return $event;
}

function ensure_lobby_player(array &$store, string $clientId, array $palette): ?array {
    if ($clientId === '') return null;
    $now = time();

    foreach ($store['lobby'] as &$player) {
        if (($player['clientId'] ?? '') === $clientId) {
            $player['lastSeen'] = $now;
            $player['connected'] = true;
            return $player;
        }
    }
    unset($player);

    $index = count($store['lobby']);
    $player = [
        'clientId' => $clientId,
        'name' => 'Player ' . min($index + 1, 4),
        'color' => $palette[$index % count($palette)],
        'ready' => false,
        'connected' => true,
        'joinedAt' => (int)floor(microtime(true) * 1000),
        'lastSeen' => $now,
    ];
    $store['lobby'][] = $player;
    return $player;
}

function lobby_snapshot(array &$store): array {
    $now = time();
    $active = [];
    foreach ($store['lobby'] as &$player) {
        $isActive = (($now - (int)($player['lastSeen'] ?? 0)) <= 20);
        $player['connected'] = $isActive;
        if (!$isActive && ($store['state']['gameStatus'] ?? 'setup') === 'setup') {
            $player['ready'] = false;
        }
        if ($isActive) {
            $active[] = $player;
        }
    }
    unset($player);

    usort($active, fn($a, $b) => ((int)$a['joinedAt']) <=> ((int)$b['joinedAt']));
    return array_map(function ($player, $index) {
        return [
            'id' => $index + 1,
            'clientId' => $player['clientId'],
            'name' => $player['name'],
            'color' => $player['color'],
            'ready' => (bool)$player['ready'],
            'connected' => true,
        ];
    }, $active, array_keys($active));
}

function start_game_from_players(array &$store, array $incomingPlayers): array {
    $players = [];
    $palette = ['#E53935', '#1E88E5', '#43A047', '#8E24AA'];
    foreach (array_slice($incomingPlayers, 0, 4) as $index => $player) {
        $players[] = [
            'id' => $index + 1,
            'name' => substr((string)($player['name'] ?? ('Player ' . ($index + 1))), 0, 18),
            'color' => normalize_color($player['color'] ?? null, $palette[$index]),
            'position' => !empty($store['settings']['startOutside']) ? 0 : 1,
            'isWinner' => false,
            'ownerClientId' => (string)($player['clientId'] ?? ''),
        ];
    }
    if (count($players) < 2) {
        return next_event($store, 'idle', 'Need at least 2 ready players.', ['private' => true]);
    }

    $store['state'] = default_game_state();
    $store['state']['players'] = $players;
    $store['state']['extraTurn'] = (bool)$store['settings']['extraTurn'];
    $store['state']['startOutside'] = (bool)$store['settings']['startOutside'];
    $store['state']['gameStatus'] = 'playing';
    return next_event($store, 'start', $players[0]['name'] . ' turn');
}

function maybe_start_from_lobby(array &$store): ?array {
    if (($store['state']['gameStatus'] ?? 'setup') !== 'setup') return null;
    $readyPlayers = lobby_snapshot($store);
    if (count($readyPlayers) < 2) return null;
    foreach ($readyPlayers as $player) {
        if (empty($player['ready'])) return null;
    }
    return start_game_from_players($store, $readyPlayers);
}

function update_lobby(array &$store, array $payload, array $palette): array {
    $clientId = (string)($payload['clientId'] ?? '');
    ensure_lobby_player($store, $clientId, $palette);

    foreach ($store['lobby'] as &$player) {
        if (($player['clientId'] ?? '') === $clientId) {
            $name = trim((string)($payload['name'] ?? $player['name'] ?? 'Player'));
            $player['name'] = substr($name !== '' ? $name : 'Player', 0, 18);
            $player['color'] = normalize_color($payload['color'] ?? null, $player['color']);
            $player['ready'] = !empty($payload['ready']);
            $player['lastSeen'] = time();
            $player['connected'] = true;
            break;
        }
    }
    unset($player);

    if (array_key_exists('extraTurn', $payload)) $store['settings']['extraTurn'] = (bool)$payload['extraTurn'];
    if (array_key_exists('startOutside', $payload)) $store['settings']['startOutside'] = (bool)$payload['startOutside'];

    $startEvent = maybe_start_from_lobby($store);
    if ($startEvent) return $startEvent;

    return next_event($store, 'lobby', !empty($payload['ready']) ? 'Player is ready' : 'Lobby updated');
}

function advance_turn(array &$state): void {
    $count = count($state['players']);
    if ($count === 0) return;
    $state['currentPlayerIndex'] = ((int)$state['currentPlayerIndex'] + 1) % $count;
    $state['turnNumber'] = (int)$state['turnNumber'] + 1;
}

function roll_dice(array &$store, array $payload, array $ladders, array $snakes): array {
    $state =& $store['state'];
    if (($state['gameStatus'] ?? 'setup') !== 'playing' || count($state['players']) === 0) {
        return next_event($store, 'idle', 'Start a game first.', ['private' => true]);
    }

    $clientId = (string)($payload['clientId'] ?? '');
    $index = (int)$state['currentPlayerIndex'];
    $player =& $state['players'][$index];
    if (($player['ownerClientId'] ?? '') !== $clientId) {
        return next_event($store, 'idle', 'Waiting for ' . $player['name'] . "'s PC.", ['private' => true]);
    }

    $rolled = random_int(1, 6);
    $state['diceValue'] = $rolled;
    $text = $player['name'] . ' rolled ' . $rolled;
    $kind = $rolled === 6 ? 'bonus' : 'roll';

    if (!empty($state['startOutside']) && (int)$player['position'] === 0) {
        if ($rolled === 1 || $rolled === 6) {
            $player['position'] = 1;
            $text = $player['name'] . ' joined the race';
            $kind = 'bonus';
        } else {
            advance_turn($state);
            return next_event($store, 'snake', 'Gate locked. Try for 1 or 6.', ['rolled' => $rolled, 'playerId' => $player['id']]);
        }
    } else {
        $target = (int)$player['position'] + $rolled;
        if ($target > 100) {
            advance_turn($state);
            return next_event($store, 'bonus', 'Exact finish needed', ['rolled' => $rolled, 'playerId' => $player['id']]);
        }
        $player['position'] = $target;
    }

    if ((int)$player['position'] === 100) {
        $player['isWinner'] = true;
        $state['gameStatus'] = 'won';
        return next_event($store, 'win', $player['name'] . ' wins!', ['rolled' => $rolled, 'playerId' => $player['id']]);
    }

    $position = (int)$player['position'];
    if (isset($ladders[$position])) {
        $player['position'] = $ladders[$position];
        $text = 'Ladder boost to ' . $ladders[$position];
        $kind = 'ladder';
    } elseif (isset($snakes[$position])) {
        $player['position'] = $snakes[$position];
        $text = 'Slide down to ' . $snakes[$position];
        $kind = 'snake';
    }

    if ((int)$player['position'] === 100) {
        $player['isWinner'] = true;
        $state['gameStatus'] = 'won';
        return next_event($store, 'win', $player['name'] . ' wins!', ['rolled' => $rolled, 'playerId' => $player['id']]);
    }

    if (!(!empty($state['extraTurn']) && $rolled === 6)) {
        advance_turn($state);
    } elseif ($kind === 'roll') {
        $text = 'Bonus turn unlocked';
        $kind = 'bonus';
    }

    return next_event($store, $kind, $text, ['rolled' => $rolled, 'playerId' => $player['id']]);
}

function respond(array $store, array $event): void {
    echo json_encode([
        'state' => $store['state'],
        'lobby' => lobby_snapshot($store),
        'settings' => $store['settings'],
        'event' => $event,
    ]);
}

$action = $_GET['action'] ?? 'state';
$clientId = (string)($_GET['clientId'] ?? '');
$lockHandle = fopen($lockFile, 'c+');
if (!$lockHandle) {
    http_response_code(500);
    echo json_encode(['error' => 'Cannot open lock file.']);
    exit;
}

flock($lockHandle, LOCK_EX);
$store = default_store();
if (is_file($stateFile)) {
    $loaded = json_decode((string)file_get_contents($stateFile), true);
    if (is_array($loaded)) $store = array_replace_recursive($store, $loaded);
}

if ($clientId !== '') ensure_lobby_player($store, $clientId, $palette);
$payload = read_json_body();
$event = is_array($store['event'] ?? null)
    ? $store['event']
    : ['id' => 0, 'kind' => 'sync', 'text' => '', 'createdAt' => (int)floor(microtime(true) * 1000)];

try {
    if ($action === 'lobby') {
        $event = update_lobby($store, $payload, $palette);
    } elseif ($action === 'roll') {
        $event = roll_dice($store, $payload, $ladders, $snakes);
    } elseif ($action === 'claim') {
        $event = next_event($store, 'claim', '');
    } elseif ($action === 'menu') {
        $store['state'] = default_game_state();
        foreach ($store['lobby'] as &$player) $player['ready'] = false;
        unset($player);
        $event = next_event($store, 'menu', '');
    } elseif ($action === 'start') {
        $event = start_game_from_players($store, lobby_snapshot($store));
    }

    file_put_contents($stateFile, json_encode($store), LOCK_EX);
    respond($store, $event);
} catch (Throwable $error) {
    http_response_code(400);
    echo json_encode(['error' => $error->getMessage()]);
}

flock($lockHandle, LOCK_UN);
fclose($lockHandle);
