"""Local web app and yt-dlp runner for MediaDock.

This service binds to loopback only. It never exposes the media tools to the
LAN and serves the PWA and its API from the same origin.
"""

from __future__ import annotations

import json
import mimetypes
import os
import re
import signal
import subprocess
import threading
import uuid
import webbrowser
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit


APP_DIR = Path(__file__).resolve().parent
WEB_DIR = APP_DIR / "web"
DOWNLOAD_DIR = APP_DIR / "downloads"
PORT = int(os.environ.get("MEDIADOCK_PORT", "8765"))
APP_ORIGIN = f"http://127.0.0.1:{PORT}"
MAX_REQUEST_BYTES = 8_192
MAX_ACTIVE_JOBS = 1


def find_tool(filename: str) -> Path | None:
    configured = os.environ.get("MEDIADOCK_TOOLS_DIR")
    candidates = []
    if configured:
        candidates.append(Path(configured) / filename)
    candidates.extend(
        [
            APP_DIR / "tools" / filename,
            APP_DIR.parent / filename,
            APP_DIR.parent / "tools" / filename,
        ]
    )
    return next((candidate.resolve() for candidate in candidates if candidate.is_file()), None)


YTDLP_PATH = find_tool("yt-dlp.exe" if os.name == "nt" else "yt-dlp")
FFMPEG_PATH = find_tool("ffmpeg.exe" if os.name == "nt" else "ffmpeg")

JOBS: dict[str, dict] = {}
JOBS_LOCK = threading.RLock()


def public_job(job: dict) -> dict:
    return {
        key: value
        for key, value in job.items()
        if key not in {"process", "thread", "source_url", "cancel_requested", "pause_requested", "remove_requested"}
    }


def clean_url(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip()
    if not value or len(value) > 2_048:
        return None
    try:
        parts = urlsplit(value)
        if parts.scheme not in {"http", "https"} or not parts.hostname:
            return None
        if parts.username or parts.password:
            return None
        # Force parsing now so malformed ports are rejected before yt-dlp starts.
        _ = parts.port
    except ValueError:
        return None
    return value


def safe_quality(value: object) -> str:
    return value if isinstance(value, str) and value in {"720", "1080", "best"} else "1080"


def safe_include_audio(value: object) -> bool:
    return value if isinstance(value, bool) else True


def make_command(job: dict) -> list[str]:
    if YTDLP_PATH is None:
        raise RuntimeError("yt-dlp was not found")

    command = [
        str(YTDLP_PATH),
        "--newline",
        "--progress",
        "--no-playlist",
        "--no-warnings",
        "--no-colors",
        "--windows-filenames",
        "--continue",
        "--part",
        "--progress-template",
        "download:__PROGRESS__%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s",
        "--print",
        "after_move:__OUTPUT__%(filepath)s",
        "--paths",
        str(DOWNLOAD_DIR),
        "--output",
        "%(title).120B [%(id)s].%(ext)s",
    ]

    if FFMPEG_PATH is not None:
        command.extend(["--ffmpeg-location", str(FFMPEG_PATH.parent)])

    if job["mode"] == "audio":
        command.extend(["-f", "ba/b", "--extract-audio", "--audio-format", "mp3"])
    else:
        quality = job["quality"]
        if not job.get("include_audio", True):
            format_selector = "bv*" if quality == "best" else f"bv*[height<={quality}]"
            command.extend(["-f", format_selector, "--remux-video", "mkv", "--ppa", "VideoRemuxer+ffmpeg_o:-an"])
        else:
            if quality == "best":
                format_selector = "bv*+ba/b"
            else:
                format_selector = f"bv*[height<={quality}]+ba/b[height<={quality}]/b"
            command.extend(["-f", format_selector])

    command.append(job["source_url"])
    return command


def set_job(job_id: str, **changes: object) -> None:
    with JOBS_LOCK:
        if job_id in JOBS:
            JOBS[job_id].update(changes)


def mark_interrupted_job(job_id: str) -> bool:
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if job is None:
            return False
        if job.get("cancel_requested"):
            if job.get("remove_requested"):
                del JOBS[job_id]
                return True
            job.update(
                process=None,
                status="cancelled",
                message="Download cancelled",
                progress=None,
                speed="",
                eta="",
            )
            return True
        if job.get("pause_requested"):
            job.update(
                process=None,
                status="paused",
                message="Paused. Resume to continue.",
                speed="",
                eta="",
            )
            return True
        return False


def terminate_process_tree(process: subprocess.Popen) -> None:
    if os.name == "nt":
        taskkill = Path(os.environ.get("WINDIR", r"C:\Windows")) / "System32" / "taskkill.exe"
        try:
            result = subprocess.run(
                [str(taskkill), "/PID", str(process.pid), "/T", "/F"],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
                timeout=8,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
            if result.returncode == 0:
                return
        except (OSError, subprocess.TimeoutExpired):
            pass
    else:
        try:
            os.killpg(process.pid, signal.SIGTERM)
            return
        except ProcessLookupError:
            return
        except OSError:
            pass

    try:
        process.kill()
    except OSError:
        pass


def run_job(job_id: str) -> None:
    with JOBS_LOCK:
        job = JOBS[job_id]
        job["status"] = "running"
        job["message"] = "Connecting to the source"
        snapshot = dict(job)

    try:
        DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
        command = make_command(snapshot)
        process = subprocess.Popen(
            command,
            cwd=str(APP_DIR),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
            shell=False,
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
            start_new_session=os.name != "nt",
        )
        set_job(job_id, process=process)
        with JOBS_LOCK:
            current = JOBS.get(job_id)
            stop_on_start = current is None or current.get("cancel_requested", False) or current.get("pause_requested", False)
        if stop_on_start:
            terminate_process_tree(process)

        last_error = ""
        assert process.stdout is not None
        for raw_line in process.stdout:
            line = raw_line.strip()
            if line.startswith("__PROGRESS__"):
                payload = line[len("__PROGRESS__") :]
                parts = payload.split("|", 2)
                percent = None
                if parts:
                    match = re.search(r"\d+(?:\.\d+)?", parts[0])
                    if match:
                        percent = max(0.0, min(100.0, float(match.group(0))))
                set_job(
                    job_id,
                    progress=percent,
                    speed=parts[1].strip() if len(parts) > 1 else "",
                    eta=parts[2].strip() if len(parts) > 2 else "",
                    message="Downloading media",
                )
            elif line.startswith("__OUTPUT__"):
                output_path = Path(line[len("__OUTPUT__") :].strip())
                try:
                    if not output_path.is_absolute():
                        output_path = DOWNLOAD_DIR / output_path
                    output_path.resolve().relative_to(DOWNLOAD_DIR.resolve())
                    output_name = output_path.name
                except (ValueError, OSError):
                    output_name = "Your file is ready"
                set_job(job_id, output_name=output_name, progress=100.0)
            elif "ERROR:" in line:
                last_error = line.split("ERROR:", 1)[-1].strip()

        return_code = process.wait()
        if mark_interrupted_job(job_id):
            return
        if return_code == 0:
            set_job(job_id, status="completed", message="Saved to your MediaDock folder", progress=100.0)
        else:
            # Do not surface subprocess output that may contain a full private URL.
            message = "Check the link and your internet connection, then try again."
            lowered = last_error.lower()
            if "unsupported url" in lowered:
                message = "This source is not supported by yt-dlp."
            elif "ffmpeg" in lowered:
                message = "FFmpeg is needed for this format. Check that ffmpeg.exe is beside the app."
            set_job(job_id, status="failed", message=message, error=message, progress=None)
    except FileNotFoundError:
        if not mark_interrupted_job(job_id):
            set_job(
                job_id,
                status="failed",
                message="yt-dlp could not be started. Check that its executable is available.",
                error="yt-dlp could not be started.",
                progress=None,
            )
    except Exception:
        if not mark_interrupted_job(job_id):
            set_job(
                job_id,
                status="failed",
                message="The download could not be started. Check the local tools and try again.",
                error="The download could not be started.",
                progress=None,
            )
    finally:
        set_job(job_id, process=None)


class MediaDockHandler(BaseHTTPRequestHandler):
    server_version = "MediaDock/0.1"

    def log_message(self, format_string: str, *args: object) -> None:
        # Keep the local console useful without logging pasted URLs.
        if self.path.startswith("/api/"):
            super().log_message(format_string, *args)

    def send_json(self, status: int, data: dict) -> None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def host_is_local(self) -> bool:
        host = self.headers.get("Host", "").lower()
        return host == f"127.0.0.1:{PORT}"

    def origin_is_local(self) -> bool:
        origin = self.headers.get("Origin")
        return origin is None or origin == APP_ORIGIN

    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler interface
        if not self.host_is_local():
            self.send_json(421, {"error": "Use the local MediaDock address."})
            return

        parts = urlsplit(self.path)
        if parts.path == "/api/status":
            self.send_json(
                200,
                {
                    "ready": YTDLP_PATH is not None and FFMPEG_PATH is not None,
                    "audioReady": YTDLP_PATH is not None and FFMPEG_PATH is not None,
                    "ytDlp": YTDLP_PATH.name if YTDLP_PATH else None,
                    "ffmpeg": FFMPEG_PATH.name if FFMPEG_PATH else None,
                    "downloadFolder": str(DOWNLOAD_DIR),
                    "maxActiveJobs": MAX_ACTIVE_JOBS,
                    "retrySupported": True,
                },
            )
            return

        if parts.path == "/api/jobs":
            with JOBS_LOCK:
                jobs = [public_job(job) for job in reversed(list(JOBS.values()))]
            self.send_json(200, {"jobs": jobs})
            return

        if parts.path.startswith("/api/jobs/"):
            job_id = parts.path.rsplit("/", 1)[-1]
            with JOBS_LOCK:
                job = JOBS.get(job_id)
                result = public_job(job) if job else None
            if result is None:
                self.send_json(404, {"error": "That download was not found."})
            else:
                self.send_json(200, result)
            return

        self.serve_static(parts.path)

    def serve_static(self, url_path: str) -> None:
        decoded = unquote(url_path)
        if decoded in {"", "/"}:
            decoded = "/index.html"
        candidate = (WEB_DIR / decoded.lstrip("/")).resolve()
        try:
            candidate.relative_to(WEB_DIR.resolve())
        except ValueError:
            self.send_error(403)
            return
        if not candidate.is_file():
            self.send_error(404)
            return

        content_type = mimetypes.guess_type(candidate.name)[0] or "application/octet-stream"
        if candidate.name.endswith(".webmanifest"):
            content_type = "application/manifest+json"
        body = candidate.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", f"{content_type}; charset=utf-8" if content_type.startswith("text/") or content_type in {"application/manifest+json", "application/javascript"} else content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        if candidate.name == "sw.js":
            self.send_header("Service-Worker-Allowed", "/")
        self.end_headers()
        self.wfile.write(body)

    def read_json_body(self) -> dict | None:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return None
        if length < 0 or length > MAX_REQUEST_BYTES:
            return None
        try:
            data = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return None
        return data if isinstance(data, dict) else None

    def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler interface
        if not self.host_is_local() or not self.origin_is_local():
            self.send_json(403, {"error": "This local action was blocked."})
            return

        route = urlsplit(self.path).path
        if route == "/api/jobs":
            body = self.read_json_body()
            if body is None:
                self.send_json(400, {"error": "Send a valid download request."})
                return
            source_url = clean_url(body.get("url"))
            if source_url is None:
                self.send_json(400, {"error": "Paste a valid http or https link."})
                return
            requested_mode = body.get("mode")
            mode = requested_mode if isinstance(requested_mode, str) and requested_mode in {"video", "audio"} else "video"
            quality = safe_quality(body.get("quality"))
            include_audio = safe_include_audio(body.get("includeAudio"))
            if YTDLP_PATH is None:
                self.send_json(503, {"error": "yt-dlp.exe was not found beside the app."})
                return
            if FFMPEG_PATH is None:
                self.send_json(503, {"error": "ffmpeg.exe is needed to merge video or convert audio."})
                return

            with JOBS_LOCK:
                active = any(job["status"] in {"queued", "running"} for job in JOBS.values())
                if active:
                    self.send_json(409, {"error": "One download is already running. Wait for it to finish first."})
                    return
                job_id = uuid.uuid4().hex[:12]
                hostname = urlsplit(source_url).hostname or "media source"
                job = {
                    "id": job_id,
                    "host": hostname,
                    "mode": mode,
                    "quality": quality,
                    "include_audio": include_audio,
                    "status": "queued",
                    "progress": 0.0,
                    "speed": "",
                    "eta": "",
                    "message": "Waiting to start",
                    "output_name": "",
                    "error": "",
                    "created_at": datetime.now().astimezone().isoformat(timespec="seconds"),
                    "source_url": source_url,
                    "cancel_requested": False,
                    "pause_requested": False,
                    "remove_requested": False,
                    "process": None,
                }
                JOBS[job_id] = job
                thread = threading.Thread(target=run_job, args=(job_id,), daemon=True)
                job["thread"] = thread
                thread.start()
                response = public_job(job)
            self.send_json(202, response)
            return

        job_route = route.strip("/").split("/")
        if len(job_route) == 4 and job_route[:2] == ["api", "jobs"] and job_route[3] in {"cancel", "pause", "resume", "retry"}:
            job_id, action = job_route[2], job_route[3]
            with JOBS_LOCK:
                job = JOBS.get(job_id)
                if not job:
                    self.send_json(404, {"error": "That download was not found."})
                    return
                process = job.get("process")
                if action == "cancel":
                    if job["status"] == "paused":
                        job.update(status="cancelled", cancel_requested=True, pause_requested=False, message="Download cancelled", progress=None, speed="", eta="")
                    elif job["status"] in {"queued", "running"}:
                        job.update(cancel_requested=True, pause_requested=False, message="Stopping download")
                    else:
                        self.send_json(409, {"error": "This download is already finished."})
                        return
                elif action == "pause":
                    if job["status"] not in {"queued", "running"}:
                        self.send_json(409, {"error": "Only an active download can be paused."})
                        return
                    job.update(pause_requested=True, cancel_requested=False, message="Pausing download")
                elif action == "resume":
                    if job["status"] != "paused":
                        self.send_json(409, {"error": "Only a paused download can be resumed."})
                        return
                    if process is not None:
                        self.send_json(409, {"error": "The download is still stopping. Try Resume again in a moment."})
                        return
                    if any(other["status"] in {"queued", "running"} for other_id, other in JOBS.items() if other_id != job_id):
                        self.send_json(409, {"error": "Another download is active. Wait for it to finish before resuming."})
                        return
                    job.update(status="queued", pause_requested=False, cancel_requested=False, message="Resuming partial download", error="")
                    thread = threading.Thread(target=run_job, args=(job_id,), daemon=True)
                    job["thread"] = thread
                    thread.start()
                else:
                    if job["status"] != "failed":
                        self.send_json(409, {"error": "Only a failed download can be retried."})
                        return
                    if process is not None:
                        self.send_json(409, {"error": "The previous attempt is still stopping. Try again in a moment."})
                        return
                    if any(other["status"] in {"queued", "running"} for other_id, other in JOBS.items() if other_id != job_id):
                        self.send_json(409, {"error": "Another download is active. Wait for it to finish before retrying."})
                        return
                    job.update(
                        status="queued",
                        progress=0.0,
                        speed="",
                        eta="",
                        message="Retrying download",
                        output_name="",
                        error="",
                        cancel_requested=False,
                        pause_requested=False,
                        remove_requested=False,
                    )
                    thread = threading.Thread(target=run_job, args=(job_id,), daemon=True)
                    job["thread"] = thread
                    thread.start()
                response = public_job(job)
            if process is not None:
                if action in {"cancel", "pause"}:
                    terminate_process_tree(process)
            self.send_json(202, {"ok": True, "job": response})
            return

        if route == "/api/open-folder":
            DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
            try:
                if os.name == "nt":
                    explorer = Path(os.environ.get("WINDIR", r"C:\Windows")) / "explorer.exe"
                    subprocess.Popen([str(explorer), str(DOWNLOAD_DIR)], shell=False)
                else:
                    subprocess.Popen(["xdg-open", str(DOWNLOAD_DIR)], shell=False)
            except OSError:
                self.send_json(500, {"error": f"Could not open the downloads folder: {DOWNLOAD_DIR}"})
                return
            self.send_json(200, {"ok": True, "path": str(DOWNLOAD_DIR)})
            return

        if route == "/api/shutdown":
            self.send_json(200, {"ok": True})
            threading.Thread(target=self.server.shutdown, daemon=True).start()
            return

        self.send_json(404, {"error": "That local action was not found."})

    def do_DELETE(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler interface
        if not self.host_is_local() or not self.origin_is_local():
            self.send_json(403, {"error": "This local action was blocked."})
            return

        job_route = urlsplit(self.path).path.strip("/").split("/")
        if len(job_route) != 3 or job_route[:2] != ["api", "jobs"]:
            self.send_json(404, {"error": "That local action was not found."})
            return

        job_id = job_route[2]
        process = None
        thread = None
        with JOBS_LOCK:
            job = JOBS.get(job_id)
            if not job:
                self.send_json(404, {"error": "That download was not found."})
                return
            if job["status"] in {"queued", "running"} or job.get("process") is not None:
                job.update(
                    cancel_requested=True,
                    pause_requested=False,
                    remove_requested=True,
                    message="Stopping download and removing it from the list",
                )
                process = job.get("process")
                thread = job.get("thread")
            else:
                del JOBS[job_id]

        if thread is not None and (thread.is_alive() or process is not None):
            if process is not None:
                terminate_process_tree(process)
            thread.join(timeout=15)
            with JOBS_LOCK:
                current = JOBS.get(job_id)
                if current is not None:
                    if thread.is_alive() or current.get("process") is not None:
                        self.send_json(409, {"error": "The download is still stopping. Wait a moment, then remove it again."})
                        return
                    del JOBS[job_id]

        self.send_json(200, {"ok": True})


def main() -> None:
    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(("127.0.0.1", PORT), MediaDockHandler)
    server.daemon_threads = True
    print(f"MediaDock is running at {APP_ORIGIN}")
    print(f"Downloads are saved in: {DOWNLOAD_DIR}")
    if YTDLP_PATH is None:
        print("yt-dlp was not found. Put yt-dlp.exe beside the media-dock folder or in media-dock/tools.")
    else:
        print(f"Using yt-dlp: {YTDLP_PATH}")
    if FFMPEG_PATH is not None:
        print(f"Using FFmpeg: {FFMPEG_PATH}")
    threading.Timer(0.8, lambda: webbrowser.open(APP_ORIGIN)).start()
    try:
        server.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        print("\nStopping MediaDock…")
    finally:
        with JOBS_LOCK:
            processes = [job.get("process") for job in JOBS.values() if job.get("process") is not None]
            for job in JOBS.values():
                if job.get("status") in {"queued", "running"}:
                    job["cancel_requested"] = True
        for process in processes:
            terminate_process_tree(process)
        server.server_close()


if __name__ == "__main__":
    main()
