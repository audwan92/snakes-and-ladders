# Shared Hosting Deployment

Upload these files and folders to your shared hosting `public_html` or game folder:

- `index.html`
- `styles.css`
- `game.js`
- `api/index.php`
- `api/.htaccess`

The PHP backend stores live game state in `api/state.json` and uses `api/state.lock`.
Those files are created automatically during play. If your host blocks file creation, make the
`api` folder writable by PHP, usually permission `755` or `775` depending on the host.

Players should open the same public URL, for example:

`https://your-domain.com/snakes/`

Each player enters a name, chooses a color, and clicks `Ready`. The game starts when every
connected player is ready.

Notes:

- This PHP version uses polling, so it works on ordinary PHP shared hosting.
- The local Node server (`server.js`) can still be used for local development.
- Game state resets if `api/state.json` is deleted.
demo :https://snake.audwan.info/
