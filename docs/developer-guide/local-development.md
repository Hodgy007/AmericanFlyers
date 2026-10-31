# Local development

This page covers installing dependencies, running the dev server, building, running with Web Bluetooth on `localhost`, testing without a trainer, and the URL parameters that jump to a stage.

## Requirements

- **Node.js.** The repository doesn't pin a version; use a current LTS release (Node 22 or newer).
- **npm.** The repository has a `package-lock.json`, so install with `npm`.
- **Chrome or Edge** for trainer work. Other browsers can run the demo ride.

## Install

```bash
npm install
```

CI uses `npm ci`, which installs exactly what `package-lock.json` records.

## Run the dev server

```bash
npm run dev
```

Vite prints a local address, usually `http://localhost:5173`. Open it in Chrome.

Web Bluetooth only works on `http://localhost` and on `https://` pages. Use `localhost` for trainer testing on your own machine. For a phone on the same network, use the live site or a secure tunnel, because a plain `http://` address on your LAN won't allow Bluetooth.

## Build

```bash
npm run build
```

This runs `tsc --noEmit`, which type-checks everything under `src/`, and then `vite build`, which writes `dist/`.

To check the production build locally:

```bash
npm run preview
```

## Environment variables

The app reads two optional variables. Without them it uses the production Neon project, defined in `src/cloud/client.ts`.

| Variable | Purpose |
| --- | --- |
| `VITE_NEON_AUTH_URL` | Overrides the Neon Auth endpoint. |
| `VITE_NEON_DATA_API_URL` | Overrides the Neon Data API endpoint. |

Vite reads them from `.env` files or the process environment. The repository doesn't ship a `.env` file. Only variables starting with `VITE_` reach the browser bundle.

Sign-in on `localhost` needs `http://localhost:5173` on the Neon Auth trusted domains list. See [Authentication setup](../admin-guide/authentication-setup.md#1-add-trusted-domains).

## Test without a trainer

You don't need a trainer to work on most of the app.

- **Demo ride.** Click **Demo ride** in the top bar. Use the slider, or **↑** and **↓**, to set power. The demo runs the full ride pipeline: physics, distance, stats and the HUD.
- **Start partway along a stage.** Add `?start=<km>` to the URL.
- **Pick a stage.** Add `?stage=<id>` to the URL.
- **Workouts in demo mode.** Start a workout from the library. The demo rider follows the target.

The URL parameters are described in [Keyboard and URL parameters](../reference/keyboard-and-url-params.md).

### Examples

- `http://localhost:5173/?stage=alpe-dhuez&start=6` starts halfway up Alpe d'Huez.
- `http://localhost:5173/?stage=stelvio` opens Stelvio Pass at the start.

## Test with a trainer

1. Close the Wahoo app and Zwift.
2. Open `http://localhost:5173` in Chrome.
3. Click **Connect trainer** and choose your trainer. The button must be clicked, because Web Bluetooth needs a user gesture.

## Working on the 3D scene

The scene's assets load from `public/`. The app uses `import.meta.env.BASE_URL` to find them, so the same code works if the app is ever served from a sub-path. If you add a model, follow [3D world](3d-world.md#adding-a-model).

## Editor and checks

The repository doesn't include an editor configuration, a linter or formatter. Follow the style of the file you're editing. Before committing, run `npm run build`. See [Testing](testing.md).
