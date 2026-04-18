import React, { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { PublicSessionData } from "@gokkehub/auth/types";
import { Button } from "@gokkehub/ui";
import { Panel } from "@gokkehub/ui";
import { Badge } from "@gokkehub/ui";
import { useToast } from "@gokkehub/ui";

interface Props {
  session: PublicSessionData;
  onSessionRefresh: () => void;
}

export default function ProfilePage({ session, onSessionRefresh }: Props) {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const [loggingOut, setLoggingOut] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState(session.avatarUrl);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAvatarClick = () => fileInputRef.current?.click();

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      addToast("Image must be under 2 MB", "error");
      return;
    }

    setUploadingAvatar(true);
    try {
      const res = await fetch("/profile/avatar", {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
        credentials: "include",
      });
      if (!res.ok) {
        const { error } = await res.json() as { error: string };
        addToast(error ?? "Upload failed", "error");
        return;
      }
      const { avatarUrl: newUrl } = await res.json() as { avatarUrl: string };
      setAvatarUrl(newUrl);
      onSessionRefresh();
      addToast("Avatar updated", "success");
    } catch {
      addToast("Upload failed — please try again", "error");
    } finally {
      setUploadingAvatar(false);
      e.target.value = "";
    }
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await fetch("/auth/logout", { method: "DELETE", credentials: "include" });
      navigate("/login", { replace: true });
    } catch {
      addToast("Logout failed — please try again", "error");
      setLoggingOut(false);
    }
  };

  const handleLinkDiscord = () => {
    window.location.href = "/auth/discord";
  };

  const handleLinkSpotify = () => {
    window.location.href = "/auth/spotify";
  };

  const handleLinkSteam = () => {
    window.location.href = "/auth/steam";
  };

  return (
    <div className="min-h-screen p-4 sm:p-8">
      <div className="max-w-lg mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-content-primary">My Account</h1>
          <Button variant="ghost" size="sm" onClick={handleLogout} loading={loggingOut}>
            Sign out
          </Button>
        </div>

        {/* Profile card */}
        <Panel>
          <div className="flex items-center gap-4">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="hidden"
              onChange={handleAvatarChange}
            />
            <button
              onClick={handleAvatarClick}
              disabled={uploadingAvatar}
              className="relative flex-shrink-0 group focus:outline-none"
              title="Change avatar"
            >
              <Avatar url={avatarUrl} name={session.displayName ?? "Player"} loading={uploadingAvatar} />
              <div className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <span className="text-white text-xs font-medium">
                  {uploadingAvatar ? "…" : "Edit"}
                </span>
              </div>
            </button>
            <div className="min-w-0">
              <p className="text-content-primary font-semibold text-lg truncate">
                {session.displayName}
              </p>
              <p className="text-content-muted text-sm truncate">{session.email}</p>
            </div>
          </div>
        </Panel>

        {/* Linked accounts */}
        <div className="space-y-3">
          <h2 className="text-content-secondary text-sm font-medium uppercase tracking-widest px-1">
            Linked accounts
          </h2>

          <LinkedAccount
            name="Discord"
            icon={<DiscordIcon />}
            linked={session.linked.discord}
            onLink={handleLinkDiscord}
            color="var(--color-discord, #5865f2)"
          />
          <LinkedAccount
            name="Spotify"
            icon={<SpotifyIcon />}
            linked={session.linked.spotify}
            onLink={handleLinkSpotify}
            color="var(--color-spotify, #1db954)"
          />
          <LinkedAccount
            name="Steam"
            icon={<SteamIcon />}
            linked={session.linked.steam}
            onLink={handleLinkSteam}
            color="var(--color-steam, #1b2838)"
          />
        </div>
      </div>
    </div>
  );
}

/* ── Sub-components ── */

function Avatar({ url, name, loading }: { url?: string | null; name: string; loading?: boolean }) {
  const base = "w-14 h-14 rounded-full flex-shrink-0";
  if (loading) {
    return (
      <div
        className={`${base} animate-pulse`}
        style={{ background: "rgb(var(--color-primary-rgb) / 0.3)" }}
      />
    );
  }
  if (url) {
    return (
      <img
        src={url}
        alt={name}
        className={`${base} object-cover`}
        style={{ border: "2px solid rgb(var(--color-primary-rgb) / 0.4)" }}
      />
    );
  }
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <div
      className={`${base} flex items-center justify-center text-lg font-bold text-white`}
      style={{ background: "rgb(var(--color-primary-rgb) / 0.6)" }}
    >
      {initials}
    </div>
  );
}

interface LinkedAccountProps {
  name: string;
  icon: React.ReactNode;
  linked: boolean;
  onLink: () => void;
  color: string;
}

function LinkedAccount({ name, icon, linked, onLink, color }: LinkedAccountProps) {
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
          <p className="text-content-primary font-medium">{name}</p>
          <p className="text-content-muted text-sm">
            {linked ? "Connected" : "Not connected"}
          </p>
        </div>
        {linked ? (
          <Badge variant="primary">Linked</Badge>
        ) : (
          <Button variant="ghost" size="sm" onClick={onLink}>
            Connect
          </Button>
        )}
      </div>
    </Panel>
  );
}

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
