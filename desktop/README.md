# Surface Browser desktop app

The web version packaged as an app for macOS and Windows: the same server and
client, running on your computer, with nothing to install or build first on a
Mac. It behaves like the web version running locally, settings panel included.

## macOS (Apple silicon)

Download [`Surface-Browser-mac-arm64.dmg`](https://github.com/heyyeah/surface-browser/releases/latest/download/Surface-Browser-mac-arm64.dmg)
from the [latest release](https://github.com/heyyeah/surface-browser/releases/latest),
open it and drag the app to Applications. It is signed and notarized, and it
updates itself when a new release is published.

Intel Macs are not supported by the download; build it yourself as below.

## Windows

There is no download for Windows yet. To build the installer yourself:

1. Install [Node.js 24 LTS](https://nodejs.org/) and [Git](https://git-scm.com/).
2. In a terminal:

   ```
   git clone https://github.com/heyyeah/surface-browser.git
   cd surface-browser
   npm ci
   cd desktop
   npm ci
   npm run dist:win
   ```

3. Run `desktop\build\dist\Surface Browser Setup <version>.exe`. The installer
   is not signed, so Windows SmartScreen warns about it: choose **More info**,
   then **Run anyway**.

`npm start` (in `desktop`) runs the app without installing it.

## Settings and data

Settings made in the app's settings panel are saved with its data:

- macOS: `~/Library/Application Support/Surface Browser`
- Windows: `%APPDATA%\Surface Browser`

A `.env` file in that folder is read at start-up, with the same variables as
`.env.example` in the repository: image search providers, GenAI endpoints and
keys. Generated images, caches and logs are kept there too.

## How it works

`main.mjs` starts the Express server inside the app on a random port, reachable
only from this computer, and opens a window on it. Links to other sites open in
your normal browser.

Pages that need JavaScript to show their images are rendered in a hidden,
sandboxed window (`page-renderer.mjs`). As with Playwright in the web version,
every request that page makes goes through the server's network checks, so it
cannot reach your local network or the app itself. `npm run test:renderer`
checks this against a hostile page.

## Building

- `npm start`: build the client and run the app from source.
- `npm run dist:mac` / `npm run dist:win`: build the installer into
  `build/dist`. On a Mac without a signing certificate, prefix it with
  `CSC_IDENTITY_AUTO_DISCOVERY=false` for an unsigned build.
- `stage.mjs` assembles `build/app`: the server, the built client and its
  production dependencies, without Playwright or the speech-to-text model. Dependencies install from
  `app-lock.json`; after changing the web dependencies or electron-updater, run
  `node stage.mjs --relock` and commit it.

## Releases (maintainer)

`.github/workflows/desktop-mac.yml` builds, signs, notarizes and publishes the
Mac app as release `v<version>`. Run it by hand from Actions > Desktop app
(macOS) > Run workflow, with a version higher than the last release, or
installed apps will not update. It needs these repository secrets:

| Secret | What |
|---|---|
| `MAC_CERT_P12_BASE64` | A **Developer ID Application** certificate with its private key, exported from Keychain Access as `.p12`, then `base64 -i cert.p12 \| pbcopy` |
| `MAC_CERT_PASSWORD` | The password chosen for that `.p12` |
| `APPLE_ID` | The Apple Account email that notarizes |
| `APPLE_APP_SPECIFIC_PASSWORD` | An app-specific password for that account, from account.apple.com |
| `APPLE_TEAM_ID` | The team ID, from the Membership page at developer.apple.com |

The certificate comes from developer.apple.com > Certificates > + >
Developer ID Application, using a certificate signing request made in Keychain
Access (Certificate Assistant > Request a Certificate From a Certificate Authority).
