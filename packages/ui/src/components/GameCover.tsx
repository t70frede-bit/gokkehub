import { useState } from "react";

export interface GameCoverProps {
  steamAppId?: number | null;
  name:        string;
  className?:  string;
}

export default function GameCover({ steamAppId, name, className = "" }: GameCoverProps) {
  const [stage, setStage] = useState<"portrait" | "header" | "none">(
    steamAppId ? "portrait" : "none",
  );

  if (stage === "none" || !steamAppId) {
    return (
      <div
        className={`w-full h-full flex items-center justify-center text-3xl font-extrabold select-none ${className}`}
        style={{
          background: "linear-gradient(135deg, rgba(var(--color-primary-rgb),0.45), rgba(var(--color-accent-rgb),0.35))",
          color: "rgba(255,255,255,0.5)",
        }}
      >
        {name.charAt(0).toUpperCase()}
      </div>
    );
  }

  const src =
    stage === "portrait"
      ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${steamAppId}/library_600x900.jpg`
      : `https://cdn.cloudflare.steamstatic.com/steam/apps/${steamAppId}/header.jpg`;

  return (
    <img
      src={src}
      alt={name}
      loading="lazy"
      className={`w-full h-full object-cover ${className}`}
      onError={() => setStage((s) => (s === "portrait" ? "header" : "none"))}
    />
  );
}
