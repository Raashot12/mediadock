# MediaDock

MediaDock is a local-first PWA for saving supported video links to this
computer. The browser interface and its small Python helper run on your own
machine; there is no hosted processing server or monthly hosting bill.

## Start it on Windows

1. Install Python 3.10 or newer if it is not already installed.
2. Keep `yt-dlp.exe` and `ffmpeg.exe` beside the `media-dock` folder, or put
   them in `media-dock/tools`.
3. Double-click `start.bat`. MediaDock opens at `http://127.0.0.1:8765`.
4. Use the **Install app** button in the browser if you want it in your app
   list. Leave the helper window running while you use the PWA.

The interface is built with React and Vite. Node.js is only needed if you want
to edit the React app or rebuild its static files; the included `web` build can
be served by Python without Node running.

## Edit the React app

From this folder, run `npm install`, then `npm run dev` and open the address
Vite prints (normally `http://127.0.0.1:5173`). In a second terminal, run
`py -3 server.py`; Vite forwards the app's API calls to the local helper.
Run `npm run build` to refresh the static app served by `start.bat`.

Downloads are saved in `media-dock/downloads`. Use **Open folder** in the app
to see them. The first release allows one active job at a time and keeps the
download queue in memory; the files themselves stay on disk.

## Features in this first version

- Download a supported link as video (up to 720p, up to 1080p, or best
  available), with sound included by default or muted, or extract audio as MP3.
- Watch download progress, speed, and estimated time remaining.
- Cancel an active download and open the output folder.
- Install the interface as a PWA and load its cached shell while offline.

The downloaded files and pasted URLs are processed locally. The app does not
upload them to a MediaDock server. Only paste links you are allowed to access
and save.

## Tool locations

MediaDock looks for the executables in this order:

1. The folder named by `MEDIADOCK_TOOLS_DIR`, if set.
2. `media-dock/tools`.
3. The parent folder of `media-dock`.
4. A `tools` folder beside `media-dock`.

You can update yt-dlp by replacing its executable. Keep FFmpeg and yt-dlp
license notices with any public distribution that includes the binaries.
