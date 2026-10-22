import { useEffect, useRef, useState } from "react";
import type { SpotifyTrack } from "../lib/types";
import { STREAM_PROXY_URL, STREAM_PROXY_TOKEN } from "../lib/types";

// Shared by the timeline game and Music Bingo. Moved out of GamePage.tsx
// unchanged.
// ── All-clients-stream audio (each browser plays its own <audio>) ─────────
// Used when settings.audioMode === "all-clients-stream". Pulls audio from
// the shared musix-bot HTTP proxy (STREAM_PROXY_URL constant). The bot
// resolves the Spotify track to a YouTube video and serves yt-dlp bytes.
//
// Each player gets independent playback — their own play/pause/volume.
// Sync mode was removed: browser autoplay restrictions made host-driven
// sync flaky (clients without prior page interaction silently dropped
// play() calls), and locally the experience is fine since everyone's
// looking at the same shared timeline UI either way.
// How long to wait for the first decodable audio before telling the player
// the proxy isn't sending anything. Generous: a cold yt-dlp spawn measured
// ~2.3s to headers on the live bot, so this only trips on a real stall.
const STREAM_STALL_MS = 15_000;

export function AllClientsAudio({
  track, coverRevealed, canScrub,
}: {
  track:                SpotifyTrack;
  coverRevealed:        boolean;
  /** Restart + click-to-seek are gated to the active team's captain so
   *  random viewers can't jump the song while a guess is being placed. */
  canScrub:             boolean;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const lastTrackRef = useRef<string | null>(null);
  // The stream is an unrange-able yt-dlp pipe — seeking with el.currentTime
  // doesn't work past whatever's already buffered. Instead we re-request
  // the stream with ?seek=N. seekOffsetSec tracks how far in the new
  // stream is, so positionMs = (seekOffsetSec * 1000) + (el.currentTime * 1000).
  const seekOffsetRef = useRef(0);
  // Bumped on every loadAt(). A deferred play retry compares against this so
  // a stale attempt can't grab the element after the track has moved on.
  const loadGenRef = useRef(0);
  // Surface the most common failure mode (bot 401 from leftover
  // STREAM_TOKEN) so the host can see what to fix instead of "nothing
  // is happening." Cleared when a new track starts loading.
  const [loadError, setLoadError] = useState<string | null>(null);
  // Local UI state read off the <audio> element via timeupdate / etc.
  const [streamPositionMs, setStreamPositionMs] = useState(0);
  const [volume, setVolume] = useState(0.85);
  const [volOpen, setVolOpen] = useState(false);
  const [localPlaying, setLocalPlaying] = useState(false);
  // True if the most recent el.play() promise rejected (autoplay policy).
  // The play button overlay then prompts the user to click — first click
  // unlocks all future autoplays for this <audio>.
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const prevVolumeRef = useRef(0.85);
  // Hover-delay timers for the volume popover. The popover floats above
  // the icon with a small gap; without these, moving the mouse from icon
  // → popover crosses the gap (outside the parent's bounding box) and
  // fires mouseleave before the mouse reaches the slider. The close-
  // delay + rehover-cancels-close pattern is shared with AudioPlayerUI.
  const popoverEnterTimer = useRef<number | null>(null);
  const popoverLeaveTimer = useRef<number | null>(null);
  function openVolPopover() {
    if (popoverLeaveTimer.current) window.clearTimeout(popoverLeaveTimer.current);
    if (popoverEnterTimer.current) window.clearTimeout(popoverEnterTimer.current);
    popoverEnterTimer.current = window.setTimeout(() => setVolOpen(true), 120);
  }
  function scheduleVolClose() {
    if (popoverEnterTimer.current) window.clearTimeout(popoverEnterTimer.current);
    if (popoverLeaveTimer.current) window.clearTimeout(popoverLeaveTimer.current);
    popoverLeaveTimer.current = window.setTimeout(() => setVolOpen(false), 200);
  }

  // Spotify gives us the authoritative duration (captured at curation
  // time). The stream's el.duration is unreliable: webm headers may
  // report wrong values, and after a ?seek= reload it represents the
  // remaining stream, not the full track. Fall back to el.duration only
  // when Spotify didn't provide one.
  const totalDurationMs = track.durationMs ?? 0;
  const positionMs = seekOffsetRef.current * 1000 + streamPositionMs;

  // Mirror audio element events into React state so the custom UI
  // (progress bar, time display, play button icon) stays in sync.
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime  = () => setStreamPositionMs(el.currentTime * 1000);
    const onPlay  = () => { setLocalPlaying(true); setAutoplayBlocked(false); };
    const onPause = () => setLocalPlaying(false);
    el.addEventListener("timeupdate",     onTime);
    el.addEventListener("play",           onPlay);
    el.addEventListener("pause",          onPause);
    el.volume = volume;
    return () => {
      el.removeEventListener("timeupdate",     onTime);
      el.removeEventListener("play",           onPlay);
      el.removeEventListener("pause",          onPause);
    };
  // volume intentionally NOT in deps — its useEffect below applies changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply volume changes to the element.
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  // Build the stream URL for a given seek offset. Used by both the
  // initial load and the seek-by-reload path. When the track has a
  // youtubeVideoId (set on tracks imported from a YouTube playlist),
  // pass it through so the bot skips the YouTube re-search and streams
  // the exact curated video — preserves the host's playlist intent.
  function streamUrl(seekSec: number): string {
    const params = new URLSearchParams({
      spotify_id: track.id,
      name:       track.name,
      artist:     track.artist,
    });
    if (track.youtubeVideoId) params.set("video_id", track.youtubeVideoId);
    if (seekSec > 0) params.set("seek", String(seekSec));
    if (STREAM_PROXY_TOKEN) params.set("token", STREAM_PROXY_TOKEN);
    return `${STREAM_PROXY_URL.replace(/\/$/, "")}/stream-track?${params}`;
  }

  // Load the stream at seekSec. Used by track change, seek bar clicks,
  // and the restart button. The bot spawns a fresh yt-dlp with
  // --download-sections "*N-" so byte N becomes byte 0 of the response.
  // Attempt playback, distinguishing the three ways play() can reject.
  //
  // Only NotAllowedError actually means "the browser blocked autoplay".
  // Treating every rejection as an autoplay block is why the host saw the
  // 🔇 banner on every single round even though they had just clicked Start:
  // the real rejection is that the source isn't ready. /stream-track is a
  // yt-dlp pipe the bot spawns per request, so the first play() routinely
  // lands before a single byte has arrived.
  //
  // `gen` guards against a retry from a superseded load stealing the element
  // out from under a newer one (track change, or a click-to-seek reload).
  function attemptPlay(el: HTMLAudioElement, gen: number, retriesLeft = 3) {
    el.play()
      .then(() => { if (gen === loadGenRef.current) setAutoplayBlocked(false); })
      .catch((err: unknown) => {
        if (gen !== loadGenRef.current) return;          // a newer load owns the element now
        const name = (err as { name?: string } | null)?.name;
        if (name === "NotAllowedError") { setAutoplayBlocked(true); return; }
        if (name === "AbortError")      return;          // interrupted by a newer load(); harmless
        if (retriesLeft <= 0)           return;          // give up quietly; the error listener reports
        // Source wasn't ready. Wait for the element to say it can play,
        // then try again — this is the common path on a cold yt-dlp spawn.
        const onCanPlay = () => {
          el.removeEventListener("canplay", onCanPlay);
          if (gen === loadGenRef.current) attemptPlay(el, gen, retriesLeft - 1);
        };
        el.addEventListener("canplay", onCanPlay);
      });
  }

  function loadAt(seekSec: number, opts: { autoplay: boolean }) {
    const el = audioRef.current;
    if (!el) return;
    seekOffsetRef.current = seekSec;
    setStreamPositionMs(0);
    const gen = ++loadGenRef.current;
    const src = streamUrl(seekSec);
    el.src = src;
    el.load();
    if (opts.autoplay) attemptPlay(el, gen);
  }

  // (Re)load audio when the track changes. Reset seek to 0 and probe
  // the proxy so we can surface specific failure modes (401 / 404).
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    if (lastTrackRef.current === track.id) return;
    lastTrackRef.current = track.id;
    setLoadError(null);
    setAutoplayBlocked(false);
    loadAt(0, { autoplay: true });

    // Diagnose failures lazily — only once something has actually gone wrong.
    // (The probe is a cheap HEAD the bot answers in ~60ms without spawning
    // yt-dlp, so this isn't about cost; it just keeps the happy path to a
    // single request and the error text to when there IS an error.)
    //
    // Two distinct failure modes are covered:
    //   • "error"  — the element rejected the source outright.
    //   • stall    — the bot returns 200 + headers but never sends a byte,
    //                so the element neither errors nor becomes playable and
    //                the UI would otherwise sit silent forever. Observed
    //                live: every /stream-track responds in ~2.3s then
    //                delivers 0 bytes, which is a bot-side yt-dlp failure.
    const el2 = audioRef.current;
    if (!el2) return;

    let stallTimer: number | null = null;
    const clearStall = () => {
      if (stallTimer !== null) { window.clearTimeout(stallTimer); stallTimer = null; }
    };
    stallTimer = window.setTimeout(() => {
      // readyState 0 = HAVE_NOTHING: headers may have arrived, but not one
      // byte of decodable audio.
      if (el2.readyState === 0) {
        setLoadError(
          "The audio proxy accepted the request but sent no audio. That's a bot-side problem " +
          "(usually yt-dlp needing an update) — the game plays fine without sound in the meantime.",
        );
      }
    }, STREAM_STALL_MS);
    const onLoadedData = () => clearStall();

    const onError = () => {
      clearStall();
      void fetch(streamUrl(0), { method: "HEAD" })
        .then(r => {
          if (r.ok) {
            setLoadError("The audio stream stopped unexpectedly. Try ▶ again.");
          } else if (r.status === 401) {
            setLoadError("Audio proxy rejected the request (401). The bot's STREAM_TOKEN env is still set — operator needs to unset it and redeploy.");
          } else if (r.status === 404) {
            setLoadError("Audio proxy couldn't resolve this track on YouTube.");
          } else {
            setLoadError(`Audio proxy returned HTTP ${r.status}.`);
          }
        })
        .catch(() => {
          setLoadError(`Couldn't reach the audio proxy at ${STREAM_PROXY_URL}. Check it's online.`);
        });
    };
    el2.addEventListener("error", onError);
    el2.addEventListener("loadeddata", onLoadedData);
    el2.addEventListener("canplay",    onLoadedData);
    return () => {
      clearStall();
      el2.removeEventListener("error", onError);
      el2.removeEventListener("loadeddata", onLoadedData);
      el2.removeEventListener("canplay",    onLoadedData);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track.id, track.name, track.artist]);

  function fmt(ms: number) {
    const s = Math.floor(ms / 1000);
    if (!isFinite(s) || s < 0) return "0:00";
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }
  function toggleMute() {
    if (volume > 0) { prevVolumeRef.current = volume; setVolume(0); }
    else { setVolume(prevVolumeRef.current || 0.7); }
  }
  const playing = localPlaying;
  const pct     = totalDurationMs > 0 ? Math.min(100, (positionMs / totalDurationMs) * 100) : 0;

  async function handleMainClick() {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      try {
        await el.play();
        setAutoplayBlocked(false);
      } catch {
        setAutoplayBlocked(true);
      }
    } else {
      el.pause();
    }
  }

  function handleRestart() {
    if (!canScrub) return;
    loadAt(0, { autoplay: true });
  }

  function handleSeekClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!canScrub) return;
    if (totalDurationMs === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const fraction  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const targetSec = Math.floor(fraction * (totalDurationMs / 1000));
    loadAt(targetSec, { autoplay: true });
  }

  return (
    <div className="flex-shrink-0 flex flex-col gap-1.5 w-full">
      {loadError && (
        <div className="rounded-md p-2 text-xs"
          style={{
            background: "rgba(220,60,60,0.10)",
            border:     "1px solid rgba(220,60,60,0.40)",
            color:      "rgb(220,140,140)",
          }}>
          ⚠ {loadError}
        </div>
      )}
      {autoplayBlocked && !playing && !loadError && (
        <div className="rounded-md p-2 text-xs flex items-center gap-2"
          style={{
            background: "rgba(var(--color-primary-rgb), 0.10)",
            border:     "1px solid rgba(var(--color-primary-rgb), 0.40)",
            color:      "rgb(var(--color-primary-rgb))",
          }}>
          🔇 Your browser blocked autoplay — click ▶ to start playback.
        </div>
      )}
      <div className="flex items-center gap-3 px-3 py-2 rounded-md w-full"
        style={{
          background: "rgb(var(--surface-raised-rgb))",
          border:     "1px solid rgb(var(--border-rgb))",
        }}>

        {/* Now-playing label (cover hidden until reveal, like the DJ bar) */}
        <div className="flex items-center gap-2 flex-shrink-0 min-w-[120px]">
          {coverRevealed && track.coverUrl ? (
            <img
              src={track.coverUrl}
              alt="Album cover"
              draggable={false}
              className="w-9 h-9 rounded-md object-cover flex-shrink-0"
              style={{ border: "1px solid rgba(var(--color-primary-rgb), 0.5)" }}
            />
          ) : (
            <div className="w-9 h-9 rounded-md flex items-center justify-center flex-shrink-0"
              style={{ background: "rgba(var(--color-primary-rgb), 0.15)", border: "1px solid rgba(var(--color-primary-rgb), 0.35)" }}>
              <span className="text-base">🎵</span>
            </div>
          )}
          <div className="hidden sm:block min-w-0">
            <p className="text-xs font-semibold opacity-80 truncate">
              {coverRevealed ? track.name : "Mystery track"}
            </p>
            <p className="text-[10px] opacity-50 truncate">
              YouTube · per-player
            </p>
          </div>
        </div>

        {/* Restart — re-requests the stream from byte 0. Captain-only
            (canScrub) so random viewers can't jump the song. */}
        {canScrub && (
          <button onClick={handleRestart}
            className="w-7 h-7 rounded flex items-center justify-center text-xs flex-shrink-0 opacity-60 hover:opacity-100 transition-opacity"
            title="Restart from beginning"
            style={{ color: "rgb(var(--text-secondary-rgb))" }}>
            ⏮
          </button>
        )}

        {/* Local play/pause — each client controls their own audio. */}
        <button onClick={handleMainClick}
          className="w-9 h-9 rounded-full flex items-center justify-center text-base flex-shrink-0 transition-transform active:scale-95"
          style={{
            background: "rgb(var(--color-primary-rgb))",
            color:      "#000",
            boxShadow:  playing ? "0 0 0 2px rgba(var(--color-primary-rgb),0.25)" : undefined,
          }}
          title={playing ? "Pause" : "Play"}>
          {playing ? "⏸" : "▶"}
        </button>

        {/* Progress bar — captain (canScrub) clicks to seek; for non-
            captains it just renders as a progress indicator (no cursor
            pointer, no click handler). Seeking re-requests the stream
            with ?seek=N because yt-dlp pipes don't support HTTP Range. */}
        <div className={`flex-1 min-w-0 relative h-1.5 rounded-full overflow-hidden${canScrub ? " cursor-pointer" : ""}`}
          style={{ background: "rgba(255,255,255,0.08)" }}
          onClick={canScrub ? handleSeekClick : undefined}>
          <div className="absolute left-0 top-0 h-full rounded-full transition-[width] duration-200"
            style={{ width: `${pct}%`, background: "rgb(var(--color-primary-rgb))" }} />
        </div>

        {/* Time display */}
        <span className="text-xs opacity-50 flex-shrink-0 font-mono whitespace-nowrap"
          style={{ fontVariantNumeric: "tabular-nums" }}>
          {fmt(positionMs)} / {fmt(totalDurationMs)}
        </span>

        {/* Volume — click icon mutes, hover opens slider. Volume is local-only
            (each client controls their own listening level). The popover
            floats above the icon with an mb-2 gap; that gap sits outside
            the parent's bounding box, so the mouse fires mouseleave when
            travelling icon → popover. The timer-delayed close + popover
            mouseenter cancelling the close keeps it open. */}
        <div className="relative flex-shrink-0"
          onMouseEnter={openVolPopover}
          onMouseLeave={scheduleVolClose}>
          <button onClick={toggleMute}
            className="w-7 h-7 flex items-center justify-center rounded opacity-60 hover:opacity-100"
            title={volume === 0 ? "Unmute" : "Mute"}>
            {volume === 0 ? "🔇" : volume < 0.5 ? "🔈" : "🔊"}
          </button>
          {volOpen && (
            <div className="absolute right-0 bottom-full pt-2 z-10"
              onMouseEnter={openVolPopover}
              onMouseLeave={scheduleVolClose}>
              <div className="px-3 py-2 rounded-md flex items-center gap-2"
                style={{
                  background: "rgb(var(--surface-overlay-rgb))",
                  border:     "1px solid rgb(var(--border-rgb))",
                  boxShadow:  "var(--shadow-card)",
                }}>
                <input type="range" min="0" max="1" step="0.05" value={volume}
                  onChange={e => setVolume(Number(e.target.value))}
                  className="orange-range w-32" />
              </div>
            </div>
          )}
        </div>

        <audio
          ref={audioRef}
          preload="auto"
          // Hidden — custom UI above drives play/pause/seek via the ref.
          // Native controls are inconsistent across browsers and clash
          // with the theme.
          style={{ display: "none" }}
        />
      </div>
    </div>
  );
}
