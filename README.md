# Surface Browser

Surface Browser is an immersive 3D web browser art piece by Tim Plaisted. Enter
a web address, an image search or an AI image prompt, and the images found
stream toward you through a curving tunnel, which opens into an interactive
sphere of those images. Rotate the sphere, select an image, and you travel
onward to whatever it links to.

There are two ways to use it:

- **On the web** at <https://sb.boxc.net>, on a desktop or mobile browser and in
  VR on Meta Quest (2, 3, 3S) and Pico 4 Ultra.
- **As a desktop app** that runs it on your own computer, where it can use your
  own image search keys and your own local AI image model, for example
  [Draw Things](https://drawthings.ai).

This repository is the source of both: the Three.js / WebXR page and the Node
service that feeds it.
[About the work](https://boxc.net/surfacebrowser.html)

## Mac app

**[Download for Mac](https://github.com/heyyeah/surface-browser/releases/latest/download/Surface-Browser-mac-arm64.dmg)**
(Apple silicon, signed and notarized). Open it, drag Surface Browser to
Applications, and it updates itself. This is the easiest way to run Surface
Browser on your own computer: nothing to install or build first.

Web addresses work straight away. Image search and AI images are set up in the
app's settings panel, or in a `.env` file in its data folder; see
[`desktop/README.md`](desktop/README.md), which also has the Windows build steps.

## Run from source

For everything the app does not do: VR in your own headset, Windows or an Intel
Mac, voice input, hosting it for other people, or changing the code.

| | Mac app | From source |
|---|---|---|
| On this computer | yes | yes |
| VR headset | no | yes, over an HTTPS tunnel |
| Host it for others | no | yes |
| Voice input | no | yes |
| Windows, Intel Mac | no (Windows: build it yourself) | yes |
| Updates | automatic | `git pull` |

Needs Node 24+ from https://nodejs.org/ (see `.nvmrc`).

```bash
npm install
cp .env.example .env

npm run dev:api    # terminal 1: API on :8788
npm run dev        # terminal 2: web page on :5173
```

Open <http://localhost:5173>. Web addresses work with no keys at all.

- **Image search** needs a provider key in `.env` (Serper, Brave, or your own
  endpoint).
- **AI images** are off until you configure a provider: a hosted one (fal) or a
  local one that speaks the Stable Diffusion WebUI API (Draw Things,
  AUTOMATIC1111). Ideally one that allows editing images such as Flux 2 Klein.
- **Pages that build their images with JavaScript** need the optional browser
  renderer: `npx playwright install chromium`, then `PLAYWRIGHT_ENABLED=1`.

`.env.example` lists every setting with its default.

## In a headset

WebXR needs HTTPS. The simplest route is a tunnel to the web port only; the page
calls the API through relative `/api/...` paths, which Vite proxies.

```bash
ngrok http 5173
```

Open the HTTPS address in the headset's browser and press **Enter VR**. Press `?`
on the page, or the Help button in VR, for the controls. A tunnel other than
ngrok needs its hostname in `VITE_ALLOWED_HOSTS`. Anyone with the tunnel address
can use your provider keys while it is open.

## Hosting it

`npm run build` writes the static site to `dist/`. Serve that and proxy
`/api/*` to `node server/index.js`, on one origin. Before putting it on the
open internet, read the "Hardening for a public host" section of
`.env.example`: by default the server trusts requests from its own machine.

## Tests

```bash
npm test
```

## Layout

- `index.html`, `src/` — the WebXR / Three.js page
- `server/` — page extraction, image proxy, search, AI relay, speech to text
- `shared/` — code used by both
- `scripts/` — the test suite and AI image tooling

## Contributing

This repository is a published snapshot; development happens elsewhere and
arrives here as one commit per release. Issues and pull requests are welcome,
and accepted changes are carried across by hand, so a merged contribution shows
up in the next release rather than as your commit.

## Licence

The software is MIT licensed: see `LICENSE`. The artwork — the name, the visual
and spatial design, and any images shipped with a release — is licensed
separately under CC BY-NC-SA 4.0: see `LICENSE-ART`.
