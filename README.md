# Surface Browser

Surface Browser is an immersive 3D web browser art piece I started in 2003. Enter
a web address, an image search or an AI image prompt, and the images found
stream toward you through a curving tunnel, which opens into an interactive
sphere of those images. Rotate the sphere, select an image, and you travel
onward to whatever it links to.

There are two ways to use it:

- **On the web** at <https://sb.boxc.net>, on a desktop or mobile browser and in
  VR on Meta Quest (2, 3, 3S) and Pico 4 Ultra.
- **As a desktop app** that runs it on your own computer, where it can use your
  own image search keys and your own local AI image model, for example
  [Draw Things](https://drawthings.ai) on a Mac.

The 2003 original was commissioned by NESTA UK and written in Java with
OpenGL / JOGL. This repository is the source of the updated
port (Three.js / Node) that I made for the new web, VR, mobile and desktop
versions. [About the work](https://boxc.net/surfacebrowser.html).

## Desktop apps

**[Download for Mac](https://github.com/heyyeah/surface-browser/releases/latest/download/Surface-Browser-mac-arm64.dmg)**
(Apple silicon). Open it and drag Surface Browser to Applications.

**[Download for Windows](https://github.com/heyyeah/surface-browser/releases/latest/download/Surface-Browser-win-x64-setup.exe)**
(64-bit). The installer is not signed yet, so Windows asks you to confirm the
first time: **More info**, then **Run anyway**. See the
[code signing policy](#code-signing-policy).

This is the easiest way to run Surface Browser on your
own computer.

Web addresses work straight away. Image search and AI images are set up in the
app's settings panel, or in a `.env` file in its data folder; see [`desktop/README.md`](desktop/README.md).

## Run from source

For everything the apps do not do: VR in your own headset, an Intel Mac, voice input, hosting it for other people, or changing the code.

| | Desktop app | From source |
|---|---|---|
| Run locally on your computer | yes | yes |
| VR headset | no | yes, over an HTTPS tunnel |
| Host it for others | no | yes |
| Voice input | no | yes |
| Intel Mac | no | yes |
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
  AUTOMATIC1111). Ideally a model that can also edit images, such as FLUX.2 [klein].
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

## History

<p align="center">
  <img src="https://boxc.net/media/SurfaceBrowser_Wired.jpg" height="170" alt="2003 screenshot of the Java version: the Wired website wrapped around the inside of a blue tunnel, with an address bar below">
  <img src="https://boxc.net/media/SurfaceBrowser_ACMI1.jpg" height="170" alt="A visitor at a console in a dark gallery, facing a projection of the blue tunnel">
  <img src="https://boxc.net/media/surface_browser_installation_shot_exhibition.jpg" height="170" alt="Gallery view at ZKM: a large projection of the blue image tunnel, with a control console on a plinth in front of it">
  <br>
  The NESTA version browsing Wired, 2003 · ACMI, Melbourne, 2004 · ZKM Karlsruhe, 2025
</p>

## Hosting it

`npm run build` writes the static site to `dist/`. Serve that and proxy
`/api/*` to `node server/index.js`, on one origin. Before putting it on the
open internet, read the "Hardening for a public host" section of
`.env.example`: by default the server trusts requests from its own machine.

## Tests

```bash
npm test
```

## Contributing

This is a published copy of my working repository. Issues and pull requests are
welcome; accepted changes are carried across by hand, so a merged contribution
shows up, with credit, in the next release.

## Code signing policy

Free code signing provided by [SignPath.io](https://signpath.io), certificate
by [SignPath Foundation](https://signpath.org). (The Windows build is not
signed yet; the application is in progress.)

- Committers and reviewers: [Tim Plaisted](https://github.com/heyyeah)
- Approvers: [Tim Plaisted](https://github.com/heyyeah)

Only Windows releases built by this repository's GitHub workflow are signed.

**Privacy.** This program will not transfer any information to other networked
systems unless you ask it to. When you do:

- web addresses you enter are fetched from those sites;
- image searches go to DuckDuckGo, or to the search provider you set up
  ([DuckDuckGo privacy policy](https://duckduckgo.com/privacy));
- AI image prompts go to the image service you set up, if any;
- the desktop app checks GitHub for updates
  ([GitHub privacy statement](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement)).

To uninstall on Windows, use **Settings → Apps → Installed apps**. On a Mac,
drag Surface Browser from Applications to the Bin.

## Thanks and credits

Additional support from ACMI, IMA and ZKM Karlsruhe. Thanks to Maria Stark at NESTA.

- Artist: Tim Plaisted
- Code: Tim Plaisted, Ryan Hodge (rendering, 2003), Nick Kaltner (networking,
  2003), Ivan Shuba (2024 update)

Shown at NESTA, Switch Media, ACMI, IMA, MAAP Festival and ZKM.

## Licence

Every file in this repository and in the downloads is MIT licensed: see
`LICENSE`. The artwork (the name, and the visual and spatial design of the
piece) is licensed separately under CC BY-NC-SA 4.0: see `LICENSE-ART`.
