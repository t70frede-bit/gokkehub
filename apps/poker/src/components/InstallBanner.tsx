import { useEffect, useState } from "react";
import { Button } from "@gokkehub/ui";

// "Add to home screen" prompt — only rendered when NOT already installed
// (Layout gates on useStandalone). Android/Chrome get a real one-tap install via
// the beforeinstallprompt event; iOS has no programmatic prompt, so we show the
// Share → Add to Home Screen instructions instead. Dismissal is remembered.

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "poker_install_dismissed_v1";

const isIOS = () =>
  typeof navigator !== "undefined" &&
  (/iphone|ipad|ipod/i.test(navigator.userAgent) ||
    // iPadOS 13+ reports as Mac but has touch
    (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1));

export default function InstallBanner() {
  const [dismissed, setDismissed] = useState(
    () => typeof localStorage !== "undefined" && localStorage.getItem(DISMISS_KEY) === "yes",
  );
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const ios = isIOS();

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault(); // stop Chrome's mini-infobar; we trigger it ourselves
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, "yes");
    setDismissed(true);
  };

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
  };

  // Nothing to offer (e.g. desktop browser with no prompt, non-iOS) → hide.
  if (dismissed || (!deferred && !ios)) return null;

  return (
    <div
      className="mb-4 p-3 rounded-lg flex items-center gap-3"
      style={{
        background: "rgb(var(--surface-raised-rgb))",
        border: "1px solid rgba(var(--color-primary-rgb), 0.4)",
      }}
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold" style={{ color: "rgb(var(--text-primary-rgb))" }}>
          Install GokkePoker
        </p>
        {deferred ? (
          <p className="text-xs mt-0.5" style={{ color: "rgb(var(--text-muted-rgb))" }}>
            Add it to your home screen for a full-screen, app-like experience.
          </p>
        ) : (
          <p className="text-xs mt-0.5" style={{ color: "rgb(var(--text-muted-rgb))" }}>
            Tap <ShareIcon /> <b>Share</b> in Safari, then <b>“Add to Home Screen.”</b>
          </p>
        )}
      </div>

      {deferred && (
        <Button size="sm" onClick={install}>Install</Button>
      )}
      <button
        onClick={dismiss}
        aria-label="Dismiss"
        className="text-lg leading-none px-1.5"
        style={{ color: "rgb(var(--text-muted-rgb))" }}
      >
        ×
      </button>
    </div>
  );
}

function ShareIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={{ display: "inline", verticalAlign: "-2px", color: "rgb(var(--color-primary-rgb))" }}>
      <path d="M12 16V4M8 8l4-4 4 4" />
      <path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
    </svg>
  );
}
