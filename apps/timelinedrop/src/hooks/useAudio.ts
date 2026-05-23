import { useCallback, useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    onSpotifyWebPlaybackSDKReady: () => void;
    Spotify: {
      Player: new (options: {
        name: string;
        getOAuthToken: (cb: (token: string) => void) => void;
        volume: number;
      }) => SpotifyPlayer;
    };
  }
}

interface SpotifyPlayer {
  connect(): Promise<boolean>;
  disconnect(): void;
  addListener(event: string, cb: (data: unknown) => void): void;
  removeListener(event: string, cb?: (data: unknown) => void): void;
  getCurrentState(): Promise<SpotifyPlayerState | null>;
  play(options: { uris: string[] }): Promise<void>;
  pause(): Promise<void>;
  seek(positionMs: number): Promise<void>;
  setVolume(vol: number): Promise<void>;
  resume(): Promise<void>;
}

interface SpotifyPlayerState {
  paused:    boolean;
  position:  number; // ms
  duration:  number; // ms
  track_window: { current_track: { id: string; name: string } };
}

export type AudioRole = "dj" | "listener";

export interface AudioControls {
  ready:      boolean;
  playing:    boolean;
  positionMs: number;
  durationMs: number;
  volume:     number;

  play:    (uri: string) => Promise<void>;
  pause:   () => Promise<void>;
  seek:    (ms: number) => Promise<void>;
  setVolume: (vol: number) => void;
}

// ── DJ hook (host with Spotify Premium) ──────────────────────────────────────

export function useDJAudio(
  onStateChange: (playing: boolean, positionMs: number) => void
): AudioControls & { captureStream: () => Promise<MediaStream | null>; deviceId: string | null } {
  const playerRef  = useRef<SpotifyPlayer | null>(null);
  const tokenRef   = useRef<string>("");
  const timerRef   = useRef<number>(0);

  const [ready,      setReady]      = useState(false);
  const [playing,    setPlaying]    = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [volume,     setVolume_]    = useState(0.8);
  const [deviceId,   setDeviceId]   = useState<string | null>(null);

  // True until the next player_state_changed after a seek() fires. The
  // SDK can emit a brief paused: true → paused: false transition during a
  // seek; without this gate, useDJAudio's transition handler relays the
  // new position to onDJStateChange, which writes a NEW playing_since
  // (= Date.now() - newPositionMs) — making the turn timer jump forward
  // by however much the captain seeked. Discarding the first transition
  // after a seek keeps playing_since anchored to the real play start.
  const seekSuppressRef = useRef(false);

  // Load SDK + get token
  useEffect(() => {
    let cancelled = false;
    const prevPausedRef = { current: null as boolean | null };

    async function init() {
      // Fetch token from our server endpoint
      const res = await fetch("/spotify/token", { credentials: "include" });
      if (!res.ok) return;
      const { access_token } = await res.json() as { access_token: string };
      tokenRef.current = access_token;

      // Load Spotify SDK script if not already present
      if (!window.Spotify) {
        await new Promise<void>((resolve) => {
          const script = document.createElement("script");
          script.src = "https://sdk.scdn.co/spotify-player.js";
          script.onload = () => resolve();
          document.head.appendChild(script);
          window.onSpotifyWebPlaybackSDKReady = resolve;
        });
      }

      if (cancelled) return;

      const player = new window.Spotify.Player({
        name:  "GokkeHub musix",
        getOAuthToken: (cb) => {
          // Re-fetch from server every time — server handles expiry + refresh
          fetch("/spotify/token", { credentials: "include" })
            .then(r => r.ok ? r.json() : null)
            .then((d: { access_token: string } | null) => {
              if (d) tokenRef.current = d.access_token;
              cb(tokenRef.current);
            })
            .catch(() => cb(tokenRef.current));
        },
        volume: 0.8,
      });

      player.addListener("ready", (data) => {
        const { device_id } = data as { device_id: string };
        setDeviceId(device_id);
        setReady(true);
      });

      player.addListener("player_state_changed", (data) => {
        const state = data as SpotifyPlayerState | null;
        if (!state) return;
        setPlaying(!state.paused);
        setPositionMs(state.position);
        setDurationMs(state.duration);
        // Only sync playing_since to Supabase on actual play/pause transitions,
        // not on every position tick — prevents the timer from constantly resetting.
        if (prevPausedRef.current !== state.paused) {
          prevPausedRef.current = state.paused;
          if (seekSuppressRef.current) {
            // Drop the post-seek paused/play blip so the timer doesn't jump.
            seekSuppressRef.current = false;
          } else {
            onStateChange(!state.paused, state.position);
          }
        }
      });

      player.addListener("not_ready", () => setReady(false));

      await player.connect();
      playerRef.current = player;
    }

    init();
    return () => {
      cancelled = true;
      playerRef.current?.disconnect();
      clearInterval(timerRef.current);
    };
  }, []);

  // Progress ticker while playing
  useEffect(() => {
    clearInterval(timerRef.current);
    if (playing) {
      timerRef.current = window.setInterval(() => {
        setPositionMs(p => p + 250);
      }, 250);
    }
    return () => clearInterval(timerRef.current);
  }, [playing]);

  const play = useCallback(async (uri: string) => {
    if (!deviceId) return;
    // Refresh token before API call
    const tokenRes = await fetch("/spotify/token", { credentials: "include" }).catch(() => null);
    if (tokenRes?.ok) {
      const d = await tokenRes.json() as { access_token: string };
      tokenRef.current = d.access_token;
    }
    const res = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${tokenRef.current}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ uris: [uri] }),
    });
    if (!res.ok && res.status !== 204) {
      const body = await res.text().catch(() => "");
      console.error("[musix] Spotify play failed:", res.status, body);
    }
  }, [deviceId]);

  const pause = useCallback(async () => {
    await playerRef.current?.pause();
  }, []);

  const seek = useCallback(async (ms: number) => {
    // Arm the suppression BEFORE the seek so the post-seek state-change
    // (if it arrives as a transition) gets dropped instead of writing a
    // new playing_since that would shift the turn timer.
    seekSuppressRef.current = true;
    await playerRef.current?.seek(ms);
  }, []);

  const setVolume = useCallback((vol: number) => {
    setVolume_(vol);
    playerRef.current?.setVolume(vol);
  }, []);

  // Capture this tab's audio for WebRTC relay
  const captureStream = useCallback(async (): Promise<MediaStream | null> => {
    try {
      // Chrome: shows "Share tab" dialog. User must tick "Share tab audio".
      const stream = await navigator.mediaDevices.getDisplayMedia({
        audio: true,
        video: false,
      } as MediaStreamConstraints);
      return stream;
    } catch {
      return null;
    }
  }, []);

  return { ready, playing, positionMs, durationMs, volume, play, pause, seek, setVolume, captureStream, deviceId };
}

// ── Listener hook (receives WebRTC audio stream) ──────────────────────────────

export function useListenerAudio(): {
  audioRef: React.RefObject<HTMLAudioElement>;
  volume:   number;
  setVolume: (v: number) => void;
  connected: boolean;
  setStream: (stream: MediaStream) => void;
} {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [volume,    setVolume_]  = useState(0.8);
  const [connected, setConnected] = useState(false);

  const setStream = useCallback((stream: MediaStream) => {
    if (!audioRef.current) return;
    audioRef.current.srcObject = stream;
    audioRef.current.play().catch(() => {
      // Autoplay may be blocked — user interaction will be needed
    });
    setConnected(true);
  }, []);

  const setVolume = useCallback((vol: number) => {
    setVolume_(vol);
    if (audioRef.current) audioRef.current.volume = vol;
  }, []);

  return { audioRef, volume, setVolume, connected, setStream };
}
