import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { LoadingManager } from "three";
import { LottieLight } from "lottie-react";
import { IconDotsVertical, IconPlayerPause, IconPlayerPlay, IconRefresh, IconTrash, IconX } from "@tabler/icons-react";
import downloadCompleteAnimation from "./assets/download-complete.json";

gsap.registerPlugin(useGSAP);
const LoaderScene = lazy(() => import("./LoaderScene.jsx"));

async function requestJson(path, options = {}) {
  const response = await fetch(path, {
    cache: "no-store",
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  if (!response.ok) throw new Error(payload.error || "The local helper could not complete that action.");
  return payload;
}

function LinkIcon() {
  return (
    <svg className="link-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M10 13.5 14 9.5m-6.2 7.7-1.2 1.2a4 4 0 0 1-5.7-5.7l4-4a4 4 0 0 1 5.7 0m3.4 5.6a4 4 0 0 0 5.7 0l4-4a4 4 0 0 0-5.7-5.7L17 5.8" />
    </svg>
  );
}

function FolderIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2.5 5.5h6l1.5 1.8h7.5v8.2h-15z" /></svg>;
}

function SaveIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.5v9m0 0 3.5-3.5M10 11.5 6.5 8M3 13v3.5h14V13" /></svg>;
}

function Header({ connected, ready, installPrompt, onInstall }) {
  const statusText = !connected ? "Helper is offline" : ready ? "Running on this device" : "Tools missing";
  return (
    <header className="topbar">
      <a className="brand" href="/" aria-label="MediaDock home">
        <span className="brand-mark" aria-hidden="true"><span></span><span></span><span></span><i></i></span>
        <span className="brand-name">MediaDock</span>
      </a>
      <div className="topbar-actions">
        <span className={`local-status ${connected && ready ? "connected" : "disconnected"}`} role="status">
          <span className="status-dot"></span><span>{statusText}</span>
        </span>
        {installPrompt && <button className="button button-quiet install-button" onClick={onInstall} type="button">Install app</button>}
      </div>
    </header>
  );
}

function ApplicationLoader({ visible, progress }) {
  const loaderRef = useRef(null);
  const [mounted, setMounted] = useState(true);

  useGSAP(() => {
    if (visible) {
      gsap.set(loaderRef.current, { autoAlpha: 1, scale: 1 });
      return undefined;
    }

    const exit = gsap.to(loaderRef.current, {
      autoAlpha: 0,
      scale: 1.015,
      duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 0.42,
      ease: "power2.inOut",
      onComplete: () => setMounted(false),
    });
    return () => exit.kill();
  }, { dependencies: [visible], revertOnUpdate: true });

  if (!mounted) return null;

  return (
    <div ref={loaderRef} className="application-loader" role="status" aria-live="polite" aria-label="Preparing MediaDock">
      <div className="loader-card">
        <div className="loader-visual" aria-hidden="true">
          <Suspense fallback={<span className="loader-scene-fallback" />}>
            <LoaderScene />
          </Suspense>
        </div>
        <div className="loader-brand"><span className="brand-mark" aria-hidden="true"><span></span><span></span><span></span><i></i></span><span>MediaDock</span></div>
        <p className="loader-caption">Preparing your workspace</p>
        <div className="loader-progress-track" role="progressbar" aria-label="Startup progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow={progress}>
          <span style={{ transform: `scaleX(${Math.max(0.08, progress / 100)})` }} />
        </div>
        <span className="loader-progress-label">{progress < 100 ? "Connecting to this device" : "Ready"}</span>
      </div>
    </div>
  );
}

function Intro() {
  const stampRef = useRef(null);
  useGSAP(() => {
    const motion = gsap.matchMedia();
    motion.add("(prefers-reduced-motion: no-preference) and (min-width: 481px)", () => {
      const pulse = gsap.timeline({
        repeat: -1,
        yoyo: true,
        defaults: { ease: "sine.inOut" },
      });
      pulse
        .to(".stamp-core", { scale: 1.035, duration: 1.8 }, 0)
        .to(".orbit-one", { scale: 1.035, opacity: 0.7, duration: 2.2 }, 0.12)
        .to(".orbit-two", { scale: 1.06, opacity: 0.62, duration: 2.5 }, 0.24);
      return () => pulse.kill();
    });
    return () => motion.revert();
  }, { scope: stampRef });

  return (
    <section className="intro" aria-labelledby="page-title">
      <div className="intro-copy">
        <h1 id="page-title">A link in.<br /><span>A file on your device.</span></h1>
        <p className="intro-description">Save a supported video or pull out its audio. Everything runs on this computer.</p>
      </div>
      <div ref={stampRef} className="intro-stamp" aria-hidden="true">
        <span className="stamp-orbit orbit-one"></span>
        <span className="stamp-orbit orbit-two"></span>
        <span className="stamp-core"><span className="stamp-play"></span></span>
        <span className="stamp-label">LOCAL<br />PROCESSING</span>
      </div>
    </section>
  );
}

function ModeIcon({ mode }) {
  if (mode === "audio") {
    return <span className="mode-icon audio-icon" aria-hidden="true"><i></i><i></i><i></i></span>;
  }
  return <span className="mode-icon video-icon" aria-hidden="true"><i></i></span>;
}

function DownloadForm({
  connected,
  ready,
  jobs,
  onSubmit,
  onNotify,
}) {
  const [url, setUrl] = useState("");
  const [mode, setMode] = useState("video");
  const [quality, setQuality] = useState("1080");
  const [includeAudio, setIncludeAudio] = useState(true);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const active = jobs.some((job) => ["queued", "running"].includes(job.status));
  const enabled = connected && ready && !active && !submitting;

  async function pasteLink() {
    try {
      const value = await navigator.clipboard.readText();
      setUrl(value.trim());
      setError("");
      document.querySelector("#media-url")?.focus();
      if (value.trim()) onNotify("Link pasted.");
    } catch {
      document.querySelector("#media-url")?.focus();
      onNotify("Clipboard access is blocked. Paste the link with Ctrl+V.");
    }
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    let parsed;
    try {
      parsed = new URL(url.trim());
    } catch {
      setError("Paste a full link that starts with http:// or https://.");
      document.querySelector("#media-url")?.focus();
      return;
    }
    if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname) {
      setError("Use a valid http or https link.");
      document.querySelector("#media-url")?.focus();
      return;
    }
    if (!enabled) {
      onNotify("Start the local helper before adding a download.");
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({ url: url.trim(), mode, quality, includeAudio });
      setUrl("");
    } catch (submitError) {
      onNotify(submitError.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="workbench" aria-labelledby="source-title">
      <div className="workbench-heading">
        <h2 id="source-title">Add a media link</h2>
        <span className="helper-chip"><span className="helper-chip-dot"></span>Saved to this device</span>
      </div>

      <form onSubmit={submit} noValidate>
        <label className="field-label" htmlFor="media-url">Video or audio link</label>
        <div className={`url-entry ${error ? "invalid" : ""}`}>
          <LinkIcon />
          <input
            id="media-url"
            name="url"
            type="url"
            placeholder="Paste a link from a supported site"
            autoComplete="url"
            spellCheck="false"
            required
            value={url}
            onChange={(event) => { setUrl(event.target.value); setError(""); }}
            aria-describedby={error ? "url-hint form-error" : "url-hint"}
            aria-invalid={Boolean(error)}
          />
          <button className="paste-button" onClick={pasteLink} type="button">Paste</button>
        </div>
        <p className="field-hint" id="url-hint">The link is handled by yt-dlp on your computer.</p>
        {error && <p className="form-error" id="form-error" role="alert">{error}</p>}

        <div className="options-row">
          <fieldset className="mode-picker">
            <legend>Save as</legend>
            {[{ value: "video", label: "Video" }, { value: "audio", label: "MP3 audio" }].map((option) => (
              <label className={`mode-option ${mode === option.value ? "selected" : ""}`} key={option.value}>
                <input type="radio" name="mode" value={option.value} checked={mode === option.value} onChange={() => setMode(option.value)} />
                <ModeIcon mode={option.value} /><span>{option.label}</span>
              </label>
            ))}
          </fieldset>

          <label className="quality-picker" hidden={mode === "audio"}>
            <span>Video quality</span>
            <select value={quality} onChange={(event) => setQuality(event.target.value)}>
              <option value="1080">Up to 1080p</option>
              <option value="720">Up to 720p</option>
              <option value="best">Best available</option>
            </select>
          </label>

          <label className="sound-picker" hidden={mode === "audio"}>
            <span>Sound</span>
            <select value={includeAudio ? "with-sound" : "no-sound"} onChange={(event) => setIncludeAudio(event.target.value === "with-sound")}>
              <option value="with-sound">With sound</option>
              <option value="no-sound">No sound</option>
            </select>
          </label>

          <button className="button button-primary download-button" disabled={!enabled} type="submit">
            <span>{submitting ? "Starting…" : "Save to device"}</span><SaveIcon />
          </button>
        </div>
      </form>

      {(!connected || !ready) && (
        <div className="tool-notice">
          <span className="notice-symbol" aria-hidden="true">!</span>
          <div>
            <strong>{!connected ? "Start the local helper" : "Media tools not found"}</strong>
            <p>{!connected
              ? "Double-click start.bat in the media-dock folder. Your saved files will stay on this computer."
              : "Place yt-dlp.exe and ffmpeg.exe beside the media-dock folder, then restart the helper."}</p>
          </div>
        </div>
      )}
    </section>
  );
}

function JobRow({ job, pendingAction, actionsEnabled, retryEnabled, onAction, onRetry }) {
  const rowRef = useRef(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState(null);

  useEffect(() => {
    if (!menuOpen) return undefined;
    function closeOnOutsidePointer(event) {
      if (!menuRef.current?.contains(event.target) && !triggerRef.current?.contains(event.target)) setMenuOpen(false);
    }
    function closeOnEscape(event) {
      if (event.key === "Escape") {
        setMenuOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  useLayoutEffect(() => {
    if (!menuOpen) return undefined;

    const positionMenu = () => {
      const trigger = triggerRef.current;
      const menu = menuRef.current;
      if (!trigger || !menu) return;

      const triggerRect = trigger.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      const padding = 12;
      const gap = 7;
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
      const menuWidth = Math.min(menuRect.width, viewportWidth - padding * 2);
      const menuHeight = Math.min(menu.scrollHeight, viewportHeight - padding * 2);
      const spaceBelow = viewportHeight - triggerRect.bottom - gap - padding;
      const spaceAbove = triggerRect.top - gap - padding;
      const placeAbove = menuHeight > spaceBelow && spaceAbove > spaceBelow;
      const availableSpace = placeAbove ? spaceAbove : spaceBelow;
      const maxHeight = Math.max(96, Math.min(viewportHeight - padding * 2, availableSpace));
      const preferredLeft = triggerRect.right - menuWidth;
      const left = Math.max(padding, Math.min(preferredLeft, viewportWidth - menuWidth - padding));
      const preferredTop = placeAbove
        ? triggerRect.top - gap - Math.min(menuHeight, maxHeight)
        : triggerRect.bottom + gap;
      const top = Math.max(padding, Math.min(preferredTop, viewportHeight - Math.min(menuHeight, maxHeight) - padding));
      const nextPosition = {
        top: `${top}px`,
        left: `${left}px`,
        maxHeight: `${maxHeight}px`,
      };

      setMenuPosition((current) => (
        current?.top === nextPosition.top
        && current?.left === nextPosition.left
        && current?.maxHeight === nextPosition.maxHeight
          ? current
          : nextPosition
      ));
      menu.dataset.placement = placeAbove ? "top" : "bottom";
    };

    positionMenu();
    const frame = window.requestAnimationFrame(positionMenu);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(positionMenu);
    if (observer) {
      if (triggerRef.current) observer.observe(triggerRef.current);
      if (menuRef.current) observer.observe(menuRef.current);
    }
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    window.visualViewport?.addEventListener("resize", positionMenu);
    window.visualViewport?.addEventListener("scroll", positionMenu);

    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
      window.visualViewport?.removeEventListener("resize", positionMenu);
      window.visualViewport?.removeEventListener("scroll", positionMenu);
    };
  }, [menuOpen]);

  useLayoutEffect(() => {
    const motion = gsap.matchMedia();
    motion.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.fromTo(rowRef.current,
        { autoAlpha: 0, y: 10 },
        { autoAlpha: 1, y: 0, duration: 0.34, ease: "power2.out", clearProps: "transform,opacity,visibility" },
      );
    });
    return () => motion.revert();
  }, []);

  const indeterminate = job.status === "queued" || (job.status === "running" && job.progress == null);
  const stats = [];
  if (typeof job.progress === "number" && job.status === "running") stats.push(`${Math.round(job.progress)}%`);
  if (job.speed) stats.push(job.speed);
  if (job.eta && job.eta !== "NA") stats.push(`ETA ${job.eta}`);
  const label = ({ queued: "Waiting", running: "In progress", paused: "Paused", completed: "Ready", failed: "Could not save", cancelled: "Cancelled" })[job.status] || "Waiting";
  const retryLabel = pendingAction === "retry"
    ? "Retrying download"
    : !actionsEnabled
      ? "Retry download. The local helper is offline."
      : !retryEnabled
        ? "Retry download. Restart the local helper to enable retry."
        : "Retry download";
  const kind = job.mode === "audio"
    ? "MP3 audio"
    : `${job.quality === "best" ? "Best available" : `Up to ${job.quality}p`} video · ${job.include_audio === false ? "no sound" : "with sound"}`;
  const active = ["queued", "running"].includes(job.status);
  const menuId = `download-actions-${job.id}`;
  const actionItems = [
    { action: "pause", label: "Pause download", available: active, icon: <IconPlayerPause size={20} stroke={2} aria-hidden="true" /> },
    { action: "resume", label: "Resume download", available: job.status === "paused", icon: <IconPlayerPlay size={20} stroke={2} aria-hidden="true" /> },
    { action: "cancel", label: "Cancel download", available: active || job.status === "paused", danger: true, icon: <IconX size={20} stroke={2} aria-hidden="true" /> },
    { action: "remove", label: "Remove from list", available: true, danger: true, icon: <IconTrash size={20} stroke={2} aria-hidden="true" /> },
  ];
  const retryControl = job.status === "failed" ? (
    <button
      className="job-retry"
      type="button"
      aria-label={retryLabel}
      title={retryLabel}
      disabled={!retryEnabled || Boolean(pendingAction)}
      onClick={() => onRetry(job.id)}
    >
      <IconRefresh size={20} stroke={2} aria-hidden="true" />
    </button>
  ) : null;

  return (
    <article ref={rowRef} className="job-row" data-mode={job.mode} data-status={job.status} data-indeterminate={indeterminate} tabIndex={-1}>
      <div className={`job-symbol ${job.status === "completed" ? "job-symbol-complete" : ""}`} aria-hidden="true">
        {job.status === "completed"
          ? <LottieLight src={downloadCompleteAnimation} autoplay loop={false} className="job-success-animation" />
          : <span></span>}
      </div>
      <div className="job-main">
        <div className="job-title-line"><strong className="job-source" title={job.host}>{job.host || "Media source"}</strong><span className="job-kind">{kind}</span></div>
        <div
          className="progress-track"
          role={typeof job.progress === "number" ? "progressbar" : undefined}
          aria-label={typeof job.progress === "number" ? `Download progress for ${job.host || "media source"}` : undefined}
          aria-valuemin={typeof job.progress === "number" ? 0 : undefined}
          aria-valuemax={typeof job.progress === "number" ? 100 : undefined}
          aria-valuenow={typeof job.progress === "number" ? Math.round(job.progress) : undefined}
          aria-hidden={typeof job.progress === "number" ? undefined : true}
        >
          <span className="progress-value" style={{ width: `${typeof job.progress === "number" ? Math.max(0, Math.min(100, job.progress)) : 0}%` }}></span>
        </div>
        <div className="job-meta">
          <div className="job-message-group">
            <span className="job-message">{job.message || "Waiting to start"}</span>
            {retryControl}
          </div>
          <span className="job-stats">{stats.join(" · ")}</span>
        </div>
      </div>
      <div className="job-actions">
        <span className="job-state">{label}</span>
        <div className="job-overflow" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setMenuOpen(false); }}>
          <button
            ref={triggerRef}
            className="job-action-trigger"
            type="button"
            aria-label={`Show actions for ${job.host || "download"}`}
            aria-expanded={menuOpen}
            aria-controls={menuId}
            title="Download actions"
            disabled={Boolean(pendingAction)}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <IconDotsVertical size={20} stroke={2} aria-hidden="true" />
          </button>
          <div ref={menuRef} id={menuId} className="job-action-popover" style={menuPosition || undefined} role="group" aria-label={`Download actions for ${job.host || "media source"}`} hidden={!menuOpen}>
              {actionItems.map(({ action, label: actionLabel, available, danger, icon }) => {
                const enabled = actionsEnabled && available && !pendingAction;
                const reason = !actionsEnabled ? "The local helper is offline" : pendingAction ? "Another action is in progress" : `Unavailable while ${job.status}`;
                return (
                  <button
                    key={action}
                    className={`job-action-option${danger ? " job-action-danger" : ""}`}
                    type="button"
                    disabled={!enabled}
                    aria-haspopup="dialog"
                    title={enabled ? actionLabel : `${actionLabel}. ${reason}.`}
                    onClick={() => {
                      if (!enabled) return;
                      triggerRef.current?.focus();
                      setMenuOpen(false);
                      onAction(job.id, action);
                    }}
                  >
                    {icon}<span>{actionLabel}</span>
                  </button>
                );
              })}
          </div>
        </div>
        {job.status === "completed" && job.output_name && <span className="job-file" title={job.output_name}>{job.output_name}</span>}
      </div>
    </article>
  );
}

function EmptyQueue() {
  return (
    <div className="empty-queue">
      <span className="empty-reel" aria-hidden="true"><i></i><i></i><i></i><i></i><b></b></span>
      <div><strong>Nothing in the queue yet</strong><p>Your downloads will appear here while they’re being saved.</p></div>
    </div>
  );
}

function Queue({ jobs, pendingActions, actionsEnabled, retryEnabled, onAction, onRetry, onOpenFolder }) {
  return (
    <section className="queue-section" aria-labelledby="queue-title">
      <div className="queue-heading">
        <h2 id="queue-title">Download queue <span className="queue-count">{jobs.length}</span></h2>
        <button className="button button-quiet folder-button" onClick={onOpenFolder} type="button"><FolderIcon />Open folder</button>
      </div>
      <div className="queue-list" aria-live="polite">
        {jobs.length === 0 ? <EmptyQueue /> : jobs.map((job) => <JobRow key={job.id} job={job} pendingAction={pendingActions.get(job.id)} actionsEnabled={actionsEnabled} retryEnabled={retryEnabled} onAction={onAction} onRetry={onRetry} />)}
      </div>
    </section>
  );
}

function Footer({ connected, onStop }) {
  return (
    <footer className="footer">
      <p>MediaDock <span>runs on your computer</span></p>
      <button className="footer-link" onClick={onStop} disabled={!connected} type="button">Stop local helper</button>
    </footer>
  );
}

export default function App() {
  const [booting, setBooting] = useState(true);
  const [bootProgress, setBootProgress] = useState(0);
  const [connection, setConnection] = useState({ connected: false, ready: false, retrySupported: false });
  const [jobs, setJobs] = useState([]);
  const [pendingActions, setPendingActions] = useState(() => new Map());
  const [dialogJobId, setDialogJobId] = useState(null);
  const [selectedAction, setSelectedAction] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [toast, setToast] = useState("");
  const toastTimer = useRef(null);
  const dialogRef = useRef(null);
  const knownStatuses = useRef(new Map());
  const notifyRef = useRef(() => {});
  const dialogJob = jobs.find((job) => job.id === dialogJobId) || null;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (dialogJobId && dialogJob && !dialog.open) dialog.showModal();
    if ((!dialogJobId || !dialogJob) && dialog.open) dialog.close();
  }, [dialogJobId, dialogJob]);

  const notify = useCallback((message) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 3200);
  }, []);
  notifyRef.current = notify;

  useEffect(() => {
    let active = true;
    const startupManager = new LoadingManager();
    startupManager.onProgress = (_url, itemsLoaded, itemsTotal) => {
      if (active && itemsTotal > 0) setBootProgress(Math.round((itemsLoaded / itemsTotal) * 100));
    };
    startupManager.onLoad = () => {
      if (active) {
        setBootProgress(100);
        setBooting(false);
      }
    };
    startupManager.itemStart("/api/status");
    startupManager.itemStart("/api/jobs");

    async function pollStatus(initial = false) {
      try {
        const status = await requestJson("/api/status");
        if (active) setConnection({ connected: true, ready: Boolean(status.ready), retrySupported: Boolean(status.retrySupported) });
      } catch {
        if (active) setConnection({ connected: false, ready: false, retrySupported: false });
      } finally {
        if (initial) startupManager.itemEnd("/api/status");
      }
    }

    async function pollJobs(initial = false) {
      try {
        const data = await requestJson("/api/jobs");
        if (!active) return;
        const nextJobs = data.jobs || [];
        for (const job of nextJobs) {
          const previous = knownStatuses.current.get(job.id);
          if (previous && previous !== job.status && job.status === "completed") {
            notifyRef.current(`Saved ${job.output_name || "your file"} to this computer.`);
          } else if (previous && previous !== job.status && job.status === "failed") {
            notifyRef.current(job.error || "The download could not be completed.");
          }
          knownStatuses.current.set(job.id, job.status);
        }
        setPendingActions((current) => {
          if (current.size === 0) return current;
          const statuses = new Map(nextJobs.map((job) => [job.id, job.status]));
          const next = new Map([...current].filter(([id, action]) => {
            const status = statuses.get(id);
            if (!status) return false;
            if (action === "pause" || action === "cancel" || action === "remove") return ["queued", "running"].includes(status);
            if (action === "resume") return status === "queued";
            if (action === "retry") return status === "failed";
            return false;
          }));
          return next.size === current.size ? current : next;
        });
        setJobs(nextJobs);
      } catch {
        // The status poll displays the helper connection state.
      } finally {
        if (initial) startupManager.itemEnd("/api/jobs");
      }
    }

    const poll = (initial = false) => { pollStatus(initial); pollJobs(initial); };
    poll(true);
    const interval = setInterval(poll, 1300);

    function onBeforeInstall(event) {
      event.preventDefault();
      setInstallPrompt(event);
    }
    function onInstalled() {
      setInstallPrompt(null);
      notifyRef.current("MediaDock is installed.");
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      active = false;
      clearInterval(interval);
      clearTimeout(toastTimer.current);
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function startDownload(data) {
    const job = await requestJson("/api/jobs", { method: "POST", body: JSON.stringify(data) });
    knownStatuses.current.set(job.id, job.status);
    setJobs((current) => [job, ...current]);
    notify("Download started on this computer.");
  }

  async function retryDownload(id) {
    setPendingActions((current) => new Map(current).set(id, "retry"));
    try {
      const response = await requestJson(`/api/jobs/${encodeURIComponent(id)}/retry`, { method: "POST", body: "{}" });
      if (response.job) {
        knownStatuses.current.set(id, response.job.status);
        setJobs((current) => current.map((job) => job.id === id ? response.job : job));
      }
      notify("Retrying download on this device.");
    } catch (error) {
      notify(error.message);
    } finally {
      setPendingActions((current) => {
        const next = new Map(current);
        next.delete(id);
        return next;
      });
    }
  }

  function openManageDialog(id, action) {
    setSelectedAction(action);
    setDialogJobId(id);
  }

  function closeManageDialog() {
    if (actionBusy) return;
    setDialogJobId(null);
    setSelectedAction("");
  }

  async function performJobAction() {
    if (!dialogJob || !selectedAction || actionBusy) return;
    const { id } = dialogJob;
    const action = selectedAction;
    setActionBusy(true);
    setPendingActions((current) => new Map(current).set(id, action));
    try {
      if (action === "remove") {
        await requestJson(`/api/jobs/${encodeURIComponent(id)}`, { method: "DELETE" });
        knownStatuses.current.delete(id);
        setJobs((current) => current.filter((job) => job.id !== id));
        notify("Download removed from the list. Saved files remain in Downloads.");
      } else {
        const response = await requestJson(`/api/jobs/${encodeURIComponent(id)}/${action}`, { method: "POST", body: "{}" });
        if (response.job) setJobs((current) => current.map((job) => job.id === id ? response.job : job));
        const messages = {
          pause: "Pausing download. You can resume it when it is ready.",
          resume: "Resuming download.",
          cancel: "Cancelling download. Any partial file may remain in Downloads.",
        };
        notify(messages[action]);
      }
      setDialogJobId(null);
      setSelectedAction("");
    } catch (error) {
      setPendingActions((current) => {
        const next = new Map(current);
        next.delete(id);
        return next;
      });
      notify(error.message);
    } finally {
      setActionBusy(false);
    }
  }

  async function openFolder() {
    try {
      const result = await requestJson("/api/open-folder", { method: "POST", body: "{}" });
      notify(`Opening downloads folder: ${result.path}`);
    } catch (error) {
      notify(error.message);
    }
  }

  async function stopHelper() {
    try {
      await requestJson("/api/shutdown", { method: "POST", body: "{}" });
      setConnection({ connected: false, ready: false, retrySupported: false });
      notify("Local helper stopped. Run start.bat to use MediaDock again.");
    } catch (error) {
      notify(error.message);
    }
  }

  async function installApp() {
    if (!installPrompt) return;
    try {
      await installPrompt.prompt();
    } finally {
      setInstallPrompt(null);
    }
  }

  return (
    <div className="page-shell">
      <Header connected={connection.connected} ready={connection.ready} installPrompt={installPrompt} onInstall={installApp} />
      <main>
        <Intro />
        <DownloadForm connected={connection.connected} ready={connection.ready} jobs={jobs} onSubmit={startDownload} onNotify={notify} />
        <Queue jobs={jobs} pendingActions={pendingActions} actionsEnabled={connection.connected} retryEnabled={connection.connected && connection.ready && connection.retrySupported} onAction={openManageDialog} onRetry={retryDownload} onOpenFolder={openFolder} />
      </main>
      <Footer connected={connection.connected} onStop={stopHelper} />
      <dialog
        ref={dialogRef}
        className="job-dialog"
        aria-labelledby="job-dialog-title"
        onCancel={(event) => { event.preventDefault(); closeManageDialog(); }}
        onClose={() => { setDialogJobId(null); setSelectedAction(""); }}
      >
        {dialogJob && (
          <>
            <div className="dialog-heading">
              <span className="dialog-kicker">CONFIRM ACTION</span>
              <button className="dialog-close" type="button" onClick={closeManageDialog} aria-label="Close dialog" disabled={actionBusy}><IconX size={20} stroke={2} aria-hidden="true" /></button>
              <h2 id="job-dialog-title">{selectedAction === "remove" ? "Remove from list?" : selectedAction === "cancel" ? "Cancel download?" : selectedAction === "pause" ? "Pause download?" : "Resume download?"}</h2>
              <p className="dialog-source">{dialogJob.host || "Media source"} <span>·</span> {dialogJob.status}</p>
            </div>
            {!selectedAction ? (
              <div className="dialog-options">
                {(["queued", "running"].includes(dialogJob.status)) && <button type="button" className="dialog-option" onClick={() => setSelectedAction("pause")}><strong>Pause</strong><span>Keep this download in the list so you can resume it.</span></button>}
                {dialogJob.status === "paused" && <button type="button" className="dialog-option" onClick={() => setSelectedAction("resume")}><strong>Resume</strong><span>Continue downloading from the saved partial file.</span></button>}
                {(["queued", "running", "paused"].includes(dialogJob.status)) && <button type="button" className="dialog-option dialog-option-danger" onClick={() => setSelectedAction("cancel")}><strong>Cancel download</strong><span>Stop it and keep the cancelled item in the list.</span></button>}
                <button type="button" className="dialog-option dialog-option-danger" onClick={() => setSelectedAction("remove")}><strong>Remove from list</strong><span>{["queued", "running"].includes(dialogJob.status) ? "Stop this active download and remove it from the queue. Its partial file may remain in Downloads." : "Remove this item from the queue. Files already saved stay on your device."}</span></button>
              </div>
            ) : (
              <div className="dialog-confirmation">
                <p>{selectedAction === "pause" && "Pause this download now? MediaDock will save its partial progress so you can resume it later."}</p>
                <p>{selectedAction === "resume" && "Resume this download from its saved partial file?"}</p>
                <p>{selectedAction === "cancel" && "Cancel this download? It will stay in the list as cancelled. A partial file may remain in Downloads."}</p>
                <p>{selectedAction === "remove" && (["queued", "running"].includes(dialogJob.status) ? "Stop this download and remove it from the list? Any partial file may remain in Downloads, and saved files will stay on your device." : "Remove this item from the list? This does not delete files already saved or partial files from Downloads.")}</p>
                <div className="dialog-buttons">
                  <button className="button button-quiet" type="button" onClick={closeManageDialog} disabled={actionBusy}>Back</button>
                  <button className={`button dialog-confirm-button ${["cancel", "remove"].includes(selectedAction) ? "danger" : ""}`} type="button" onClick={performJobAction} disabled={actionBusy}>
                    {actionBusy ? "Please wait…" : selectedAction === "remove" ? "Remove from list" : selectedAction === "cancel" ? "Cancel download" : selectedAction === "pause" ? "Pause download" : "Resume download"}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </dialog>
      <div className={`toast ${toast ? "visible" : ""}`} role="status" aria-live="polite">{toast}</div>
      <ApplicationLoader visible={booting} progress={bootProgress} />
    </div>
  );
}
