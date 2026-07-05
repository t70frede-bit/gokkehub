import { Button, Panel } from "@gokkehub/ui";
import type { JpPowerupPrompt } from "../lib/types";
import { POWERUP_META } from "../lib/types";

interface PowerUpPromptProps {
  prompt: JpPowerupPrompt;
  /** Set on the winning player's phone; undefined renders the passive big-screen version. */
  onChoice?: (choice: "points" | "powerup") => void;
  busy?: boolean;
}

export default function PowerUpPrompt({ prompt, onChoice, busy = false }: PowerUpPromptProps) {
  const meta = POWERUP_META[prompt.powerupType];
  return (
    <Panel className="text-center">
      <p className="text-4xl mb-1">{meta.icon}</p>
      <h3 className="font-black text-xl mb-1">Power-up tile!</h3>
      <p className="text-sm mb-1" style={{ color: "rgb(var(--text-secondary-rgb))" }}>
        {meta.name} — {meta.desc.toLowerCase()}
      </p>
      {prompt.currentPowerup && (
        <p className="text-xs mb-1" style={{ color: "rgb(var(--color-danger-rgb))" }}>
          Claiming replaces your {POWERUP_META[prompt.currentPowerup].icon} {POWERUP_META[prompt.currentPowerup].name}
        </p>
      )}
      {onChoice ? (
        <div className="flex gap-3 mt-4">
          <Button fullWidth size="lg" variant="ghost" loading={busy} onClick={() => onChoice("points")}>
            Take {prompt.value} points
          </Button>
          <Button fullWidth size="lg" loading={busy} onClick={() => onChoice("powerup")}>
            Claim {meta.icon} {meta.name}
          </Button>
        </div>
      ) : (
        <p className="mt-3 font-bold animate-pulse" style={{ color: "rgb(var(--color-primary-rgb))" }}>
          Choosing: {prompt.value} points or {meta.icon} {meta.name}…
        </p>
      )}
    </Panel>
  );
}
