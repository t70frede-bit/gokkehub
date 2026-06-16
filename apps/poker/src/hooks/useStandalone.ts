import { useEffect, useState } from "react";

// True when the app is running as an installed PWA (home-screen) rather than in
// a browser tab. Covers Android/Chrome (display-mode) and iOS Safari
// (navigator.standalone, which isn't in the standard display-mode query).
function check(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    // @ts-expect-error iOS-only, non-standard
    window.navigator.standalone === true
  );
}

export function useStandalone(): boolean {
  const [standalone, setStandalone] = useState(check);
  useEffect(() => {
    const mq = window.matchMedia("(display-mode: standalone)");
    const on = () => setStandalone(check());
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return standalone;
}
