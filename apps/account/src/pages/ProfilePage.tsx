import React, { useRef, useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import type { PublicSessionData } from "@gokkehub/auth/types";
import { Button, Panel, useToast } from "@gokkehub/ui";

interface Props {
  session: PublicSessionData;
  onSessionRefresh: () => void;
}

export default function ProfilePage({ session, onSessionRefresh }: Props) {
  const { addToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [avatarUrl, setAvatarUrl] = useState(session.avatarUrl);

  useEffect(() => {
    const error = searchParams.get("error");
    if (error) {
      const messages: Record<string, string> = {
        spotify_denied:  "Spotify connection was denied or cancelled.",
        spotify_token:   "Spotify login failed — check your Spotify app credentials.",
        spotify_user:    "Could not fetch Spotify profile after login.",
      };
      addToast(messages[error] ?? `OAuth error: ${error}`, "error");
      setSearchParams({}, { replace: true });
    }
  }, []);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [removingAvatar, setRemovingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(session.displayName ?? "");
  const [savingName, setSavingName] = useState(false);

  const [editingSteamId, setEditingSteamId] = useState(false);
  const [steamIdValue, setSteamIdValue] = useState(session.steamId ?? "");
  const [savingSteamId, setSavingSteamId] = useState(false);

  const [disconnecting, setDisconnecting] = useState<"discord" | "spotify" | "steam" | "lastfm" | null>(null);

  /* ── Avatar ── */

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { addToast("Image must be under 2 MB", "error"); return; }
    setUploadingAvatar(true);
    try {
      const res = await fetch("/profile/avatar", {
        method: "PUT", headers: { "Content-Type": file.type }, body: file, credentials: "include",
      });
      if (!res.ok) { addToast(((await res.json()) as { error: string }).error ?? "Upload failed", "error"); return; }
      const { avatarUrl: newUrl } = (await res.json()) as { avatarUrl: string };
      setAvatarUrl(newUrl); onSessionRefresh(); addToast("Avatar updated", "success");
    } catch { addToast("Upload failed — please try again", "error"); }
    finally { setUploadingAvatar(false); e.target.value = ""; }
  };

  const handleRemoveAvatar = async () => {
    setRemovingAvatar(true);
    try {
      const res = await fetch("/profile/avatar", { method: "DELETE", credentials: "include" });
      if (!res.ok) { addToast("Failed to remove avatar", "error"); return; }
      setAvatarUrl(null); onSessionRefresh(); addToast("Avatar removed", "success");
    } catch { addToast("Failed to remove avatar", "error"); }
    finally { setRemovingAvatar(false); }
  };

  /* ── Display name ── */

  const handleSaveName = async () => {
    const trimmed = nameValue.trim();
    if (!trimmed || trimmed.length > 32) { addToast("Display name must be 1–32 characters", "error"); return; }
    setSavingName(true);
    try {
      const res = await fetch("/profile/update", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ displayName: trimmed }),
      });
      if (!res.ok) { addToast(((await res.json()) as { error: string }).error ?? "Failed to save", "error"); return; }
      onSessionRefresh(); setEditingName(false); addToast("Display name updated", "success");
    } catch { addToast("Failed to save name", "error"); }
    finally { setSavingName(false); }
  };

  /* ── Steam ID ── */

  const handleSaveSteamId = async () => {
    setSavingSteamId(true);
    try {
      const res = await fetch("/profile/steam-id", {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ steamId: steamIdValue.trim() || null }),
      });
      if (!res.ok) { addToast("Failed to save Steam ID", "error"); return; }
      onSessionRefresh();
      setEditingSteamId(false);
      addToast(steamIdValue.trim() ? "Steam ID saved" : "Steam ID removed", "success");
    } catch { addToast("Failed to save Steam ID", "error"); }
    finally { setSavingSteamId(false); }
  };

  /* ── Linked accounts ── */

  const handleDisconnect = async (provider: "discord" | "spotify" | "steam" | "lastfm") => {
    setDisconnecting(provider);
    try {
      const res = await fetch(`/auth/${provider}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) { addToast(`Failed to disconnect ${provider}`, "error"); return; }
      onSessionRefresh();
      addToast(`${provider.charAt(0).toUpperCase() + provider.slice(1)} disconnected`, "success");
    } catch { addToast(`Failed to disconnect ${provider}`, "error"); }
    finally { setDisconnecting(null); }
  };

  return (
    <div className="p-4 sm:p-8">
      <div className="max-w-lg mx-auto space-y-6">

        <h1 className="text-2xl font-bold" style={{ color: "rgb(var(--text-primary-rgb))" }}>My Account</h1>

        {/* Avatar + identity card */}
        <Panel>
          <div className="flex items-center gap-4">
            <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={handleAvatarChange} />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingAvatar}
              className="relative flex-shrink-0 group focus:outline-none"
              title="Change avatar"
            >
              <AvatarCircle url={avatarUrl} name={session.displayName ?? "Player"} loading={uploadingAvatar} />
              <div className="absolute inset-0 rounded-full bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
              </div>
            </button>

            <div className="flex-1 min-w-0">
              <p className="font-semibold text-lg truncate" style={{ color: "rgb(var(--text-primary-rgb))" }}>
                {session.displayName ?? "—"}
              </p>
              <p className="text-sm truncate" style={{ color: "rgb(var(--text-muted-rgb))" }}>
                {session.email ?? "No email"}
              </p>
            </div>

            {avatarUrl && (
              <ChipButton onClick={handleRemoveAvatar} loading={removingAvatar} danger>
                Remove photo
              </ChipButton>
            )}
          </div>
        </Panel>

        {/* Profile settings */}
        <SectionLabel>Profile</SectionLabel>

        {/* Display name */}
        <SettingRow
          label="Display name"
          value={session.displayName ?? "—"}
          editing={editingName}
          onEdit={() => { setEditingName(true); setNameValue(session.displayName ?? ""); }}
          onCancel={() => { setEditingName(false); setNameValue(session.displayName ?? ""); }}
        >
          <div className="flex gap-2">
            <input
              type="text"
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              maxLength={32}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveName();
                if (e.key === "Escape") { setEditingName(false); setNameValue(session.displayName ?? ""); }
              }}
              className="input flex-1"
              placeholder="Your display name"
            />
            <Button size="sm" onClick={handleSaveName} loading={savingName}>Save</Button>
            <ChipButton onClick={() => { setEditingName(false); setNameValue(session.displayName ?? ""); }}>Cancel</ChipButton>
          </div>
        </SettingRow>

        {/* Steam */}
        <SectionLabel>Steam</SectionLabel>

        <SettingRow
          label="Steam ID"
          value={session.steamId ? session.steamId : "Not set"}
          editing={editingSteamId}
          onEdit={() => { setEditingSteamId(true); setSteamIdValue(session.steamId ?? ""); }}
          onCancel={() => { setEditingSteamId(false); setSteamIdValue(session.steamId ?? ""); }}
        >
          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                type="text"
                value={steamIdValue}
                onChange={(e) => setSteamIdValue(e.target.value)}
                autoFocus
                className="input flex-1"
                placeholder="e.g. 76561198012345678 or your vanity name"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveSteamId();
                  if (e.key === "Escape") { setEditingSteamId(false); setSteamIdValue(session.steamId ?? ""); }
                }}
              />
              <Button size="sm" onClick={handleSaveSteamId} loading={savingSteamId}>Save</Button>
              <ChipButton onClick={() => { setEditingSteamId(false); setSteamIdValue(session.steamId ?? ""); }}>Cancel</ChipButton>
            </div>
            <p className="text-xs" style={{ color: "rgb(var(--text-muted-rgb))" }}>
              Find your Steam ID at{" "}
              <a
                href="https://store.steampowered.com/account/"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
                style={{ color: "rgb(var(--color-primary-rgb))" }}
              >
                store.steampowered.com/account
              </a>
              {" "}— or enter your vanity username or full profile URL.
              Your Steam profile must be set to <strong>Public</strong>.
            </p>
          </div>
        </SettingRow>

        {/* Linked accounts */}
        <SectionLabel>Linked accounts</SectionLabel>

        <LinkedAccountRow
          name="Discord"
          icon={<DiscordIcon />}
          linked={session.linked.discord}
          disconnecting={disconnecting === "discord"}
          onLink={() => { window.location.href = "/auth/discord"; }}
          onDisconnect={() => handleDisconnect("discord")}
          color="#5865f2"
          description="Sign in and view your game activity"
        />
        <LinkedAccountRow
          name="Spotify"
          icon={<SpotifyIcon />}
          linked={session.linked.spotify}
          disconnecting={disconnecting === "spotify"}
          onLink={() => { window.location.href = "/auth/spotify"; }}
          onDisconnect={() => handleDisconnect("spotify")}
          color="#1db954"
          betaBadge="Closed testing"
          description="Allowlisted accounts only — ask the host to add yours"
          scopeWarning={(() => {
            if (!session.linked.spotify) return undefined;
            const required = ["streaming", "playlist-read-private", "user-modify-playback-state", "user-top-read"];
            const granted  = (session.spotifyScopes ?? "").split(" ");
            const missing  = required.filter(s => !granted.includes(s));
            return missing.length > 0 ? "Missing permissions — disconnect and reconnect to fix" : undefined;
          })()}
        />
        <LinkedAccountRow
          name="Steam"
          icon={<SteamIcon />}
          linked={session.linked.steam}
          disconnecting={disconnecting === "steam"}
          onLink={() => { window.location.href = "/auth/steam"; }}
          onDisconnect={() => handleDisconnect("steam")}
          color="#66c0f4"
          description="View your game library"
        />
        <LastfmRow
          username={session.lastfmUsername ?? null}
          disconnecting={disconnecting === "lastfm"}
          onSave={async (username) => {
            const res = await fetch("/auth/lastfm", {
              method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
              body: JSON.stringify({ username }),
            });
            if (!res.ok) {
              const data = await res.json().catch(() => ({})) as { error?: string };
              addToast(data.error ?? "Couldn't link Last.fm", "error");
              return;
            }
            onSessionRefresh();
            addToast("Last.fm connected", "success");
          }}
          onDisconnect={() => handleDisconnect("lastfm")}
        />

      </div>
    </div>
  );
}

/* ── Shared small components ── */

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="text-xs font-semibold uppercase tracking-widest px-1 pt-2"
      style={{ color: "rgb(var(--text-muted-rgb))" }}
    >
      {children}
    </h2>
  );
}

interface SettingRowProps {
  label: string;
  value: string;
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  children: React.ReactNode;
}

function SettingRow({ label, value, editing, onEdit, children }: SettingRowProps) {
  return (
    <Panel variant="bare">
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide" style={{ color: "rgb(var(--text-muted-rgb))" }}>
            {label}
          </span>
          {!editing && (
            <button
              onClick={onEdit}
              className="flex items-center gap-1 text-xs font-medium rounded-md px-2 py-1 transition-all"
              style={{
                color: "rgb(var(--color-primary-rgb))",
                background: "rgba(var(--color-primary-rgb), 0.1)",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(var(--color-primary-rgb), 0.18)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(var(--color-primary-rgb), 0.1)"; }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
              Edit
            </button>
          )}
        </div>
        {editing ? children : (
          <p className="font-medium" style={{ color: "rgb(var(--text-primary-rgb))" }}>{value}</p>
        )}
      </div>
    </Panel>
  );
}

interface ChipButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean;
  danger?: boolean;
}

function ChipButton({ loading, danger, children, disabled, style, ...props }: ChipButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      className="flex items-center gap-1.5 text-sm font-medium rounded-lg px-3 py-1.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
      style={{
        color: danger ? "rgb(var(--color-danger-rgb))" : "rgb(var(--text-secondary-rgb))",
        background: danger ? "rgba(var(--color-danger-rgb), 0.08)" : "rgba(var(--surface-raised-rgb), 0.6)",
        border: `1px solid ${danger ? "rgba(var(--color-danger-rgb), 0.25)" : "rgba(255,255,255,0.08)"}`,
        ...style,
      }}
      {...props}
    >
      {loading ? <SpinnerIcon /> : null}
      {children}
    </button>
  );
}

function SpinnerIcon() {
  return (
    <svg style={{ width: "12px", height: "12px", animation: "spin 0.75s linear infinite" }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>
  );
}

/* ── Avatar ── */

function AvatarCircle({ url, name, loading }: { url?: string | null; name: string; loading?: boolean }) {
  const base = "w-14 h-14 rounded-full flex-shrink-0";
  if (loading) return <div className={`${base} animate-pulse`} style={{ background: "rgba(var(--color-primary-rgb), 0.3)" }} />;
  if (url) return <img src={url} alt={name} className={`${base} object-cover`} style={{ border: "2px solid rgba(var(--color-primary-rgb), 0.4)" }} />;
  const initials = name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div className={`${base} flex items-center justify-center text-lg font-bold text-white`} style={{ background: "rgba(var(--color-primary-rgb), 0.6)" }}>
      {initials}
    </div>
  );
}

/* ── Linked account row ── */

interface LinkedAccountRowProps {
  name: string;
  icon: React.ReactNode;
  linked: boolean;
  disconnecting: boolean;
  onLink: () => void;
  onDisconnect: () => void;
  color: string;
  description: string;
  scopeWarning?: string;
  /** When set, renders a small amber "Closed testing" pill next to the
   *  account name — used to telegraph Spotify's 5/25-user dev allowlist
   *  before a user wastes time trying to link and seeing a silent fail. */
  betaBadge?: string;
}

function LinkedAccountRow({ name, icon, linked, disconnecting, onLink, onDisconnect, color, description, scopeWarning, betaBadge }: LinkedAccountRowProps) {
  return (
    <Panel variant="bare">
      <div className="flex items-center gap-4 p-4">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: color + "22", color }}
        >
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-medium" style={{ color: "rgb(var(--text-primary-rgb))" }}>{name}</p>
            {betaBadge && (
              <span
                className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                style={{
                  background: "rgba(220,160,0,0.16)",
                  border:     "1px solid rgba(220,160,0,0.45)",
                  color:      "rgb(220,160,0)",
                }}
                title="Spotify is in Closed Testing — only allowlisted Spotify accounts can link until Spotify approves the app for wider access."
              >
                {betaBadge}
              </span>
            )}
          </div>
          <p className="text-sm" style={{ color: scopeWarning ? "rgb(220,160,0)" : linked ? "rgba(34,197,94,0.85)" : "rgb(var(--text-muted-rgb))" }}>
            {scopeWarning ?? (linked ? "Connected" : description)}
          </p>
        </div>
        {linked ? (
          <ChipButton onClick={onDisconnect} loading={disconnecting} danger>
            Disconnect
          </ChipButton>
        ) : (
          <ChipButton onClick={onLink}>
            Connect
          </ChipButton>
        )}
      </div>
    </Panel>
  );
}

/* ── Last.fm row (username-based, no OAuth) ── */

interface LastfmRowProps {
  username:      string | null;
  disconnecting: boolean;
  onSave:        (username: string) => Promise<void>;
  onDisconnect:  () => void;
}

function LastfmRow({ username, disconnecting, onSave, onDisconnect }: LastfmRowProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue]     = useState("");
  const [saving, setSaving]   = useState(false);

  const linked = !!username;

  async function handleSave() {
    if (!value.trim()) return;
    setSaving(true);
    try { await onSave(value.trim()); setEditing(false); setValue(""); }
    finally { setSaving(false); }
  }

  return (
    <Panel variant="bare">
      <div className="flex items-center gap-4 p-4">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: "#d5101622", color: "#d51016" }}>
          <LastfmIcon />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium" style={{ color: "rgb(var(--text-primary-rgb))" }}>Last.fm</p>
          {linked ? (
            <p className="text-sm truncate" style={{ color: "rgba(34,197,94,0.85)" }}>
              Connected as <strong>{username}</strong>
            </p>
          ) : editing ? (
            <div className="flex items-center gap-2 mt-1">
              <input
                value={value}
                onChange={e => setValue(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSave()}
                placeholder="Last.fm username"
                maxLength={30}
                autoFocus
                className="flex-1 min-w-0 rounded-lg px-2 py-1 text-sm outline-none"
                style={{
                  background: "rgba(var(--surface-raised-rgb),0.5)",
                  border:     "1px solid rgba(255,255,255,0.1)",
                  color:      "inherit",
                }}
              />
            </div>
          ) : (
            <p className="text-sm" style={{ color: "rgb(var(--text-muted-rgb))" }}>
              Link your Last.fm to get familiar songs in your games
            </p>
          )}
        </div>
        {linked ? (
          <ChipButton onClick={onDisconnect} loading={disconnecting} danger>
            Disconnect
          </ChipButton>
        ) : editing ? (
          <ChipButton onClick={handleSave} loading={saving}>Save</ChipButton>
        ) : (
          <ChipButton onClick={() => setEditing(true)}>Connect</ChipButton>
        )}
      </div>
    </Panel>
  );
}

function LastfmIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M11.13 17.16c-2.49 0-4.51-2.02-4.51-4.51 0-2.5 2.02-4.52 4.51-4.52 1.06 0 2.07.36 2.88 1.03l.93-1.39a6.42 6.42 0 0 0-3.81-1.24A6.43 6.43 0 0 0 4.7 12.65a6.43 6.43 0 0 0 6.43 6.43c2.5 0 4.71-1.4 5.81-3.46l-1.46-.95c-.78 1.45-2.31 2.49-4.35 2.49zm6.57 0c-1.4 0-1.7-.65-1.7-1.66V8.7h-1.66v6.95c0 1.97 1.05 3.18 3.36 3.18h.6v-1.67h-.6z"/>
    </svg>
  );
}

/* ── Provider icons ── */

function DiscordIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057c.002.022.015.043.033.055a19.89 19.89 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

function SpotifyIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
    </svg>
  );
}

function SteamIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.188.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.031 4.524 4.527s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.727L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0zM7.54 18.21l-1.473-.61c.262.543.714.999 1.314 1.25 1.297.539 2.793-.076 3.332-1.375.263-.63.264-1.319.005-1.949s-.75-1.121-1.377-1.383c-.624-.26-1.299-.244-1.878-.03l1.523.63c.956.4 1.409 1.5 1.009 2.455-.397.957-1.497 1.41-2.455 1.012H7.54zm11.415-9.303c0-1.662-1.353-3.015-3.015-3.015-1.665 0-3.015 1.353-3.015 3.015 0 1.665 1.35 3.015 3.015 3.015 1.663 0 3.015-1.35 3.015-3.015zm-5.273-.005c0-1.252 1.013-2.266 2.265-2.266 1.249 0 2.266 1.014 2.266 2.266 0 1.251-1.017 2.265-2.266 2.265-1.252 0-2.265-1.014-2.265-2.265z" />
    </svg>
  );
}
