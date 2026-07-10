import { useSearchParams } from "react-router-dom";
import { Button, Panel } from "@gokkehub/ui";

const ERROR_MESSAGES: Record<string, string> = {
  discord_denied: "Discord login was cancelled.",
  discord_token:  "Discord login failed — check app credentials.",
  discord_user:   "Could not fetch Discord profile.",
};

const ALLOWED_REDIRECT_ORIGINS = ["https://jeopardy.gokkehub.com", "https://gokkehub.com"];

export default function LoginPage() {
  const [searchParams] = useSearchParams();
  const errorKey = searchParams.get("error");
  const errorMsg = errorKey ? (ERROR_MESSAGES[errorKey] ?? `Login error: ${errorKey}`) : null;

  const redirectParam = searchParams.get("redirect");

  const startLogin = (provider: "discord" | "spotify") => {
    if (redirectParam) {
      try {
        const origin = new URL(redirectParam).origin;
        if (ALLOWED_REDIRECT_ORIGINS.includes(origin)) {
          sessionStorage.setItem("post_login_redirect", redirectParam);
        }
      } catch { /* malformed URL — ignore */ }
    }
    window.location.href = `/auth/${provider}`;
  };

  return (
    <div className="flex-1 flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-5">

        <div className="text-center">
          <p className="text-sm" style={{ color: "rgb(var(--text-muted-rgb))" }}>
            Sign in to continue
          </p>
          {errorMsg && (
            <p className="mt-2 text-sm" style={{ color: "rgb(239,68,68)" }}>{errorMsg}</p>
          )}
        </div>

        <Panel variant="bare">
          <div style={{ padding: "28px 28px 24px" }}>
            <p className="font-semibold text-center mb-6" style={{ color: "rgb(var(--text-primary-rgb))" }}>
              Welcome to GokkeHub
            </p>

            <Button variant="ghost" fullWidth onClick={() => startLogin("discord")}>
              <span className="flex items-center justify-center gap-2 w-full">
                <DiscordIcon />
                Continue with Discord
              </span>
            </Button>

            <div className="my-3 flex items-center gap-3" style={{ color: "rgb(var(--text-muted-rgb))" }}>
              <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.08)" }} />
              <span style={{ fontSize: "var(--text-xs)" }}>or</span>
              <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.08)" }} />
            </div>

            {/* Spotify-only login — lower-friction path for players who just
                want to drop into a musix game without setting up a Discord
                account. Creates a session with userId "sp:<spotify_id>"
                and pulls display name + avatar from the Spotify profile. */}
            <Button variant="ghost" fullWidth onClick={() => startLogin("spotify")}>
              <span className="flex items-center justify-center gap-2 w-full">
                <SpotifyIcon />
                Continue with Spotify
              </span>
            </Button>
          </div>
        </Panel>

      </div>
    </div>
  );
}

function DiscordIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057c.002.022.015.043.033.055a19.89 19.89 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z" />
    </svg>
  );
}

function SpotifyIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="#1DB954" aria-hidden>
      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.84-.18-.962-.601-.12-.42.18-.84.6-.961 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.139zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.42 1.56-.299.421-1.02.599-1.559.3z"/>
    </svg>
  );
}
