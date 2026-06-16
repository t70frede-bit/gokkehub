import { useState } from "react";
import AdminTransactions from "./AdminTransactions";
import AdminPlayers from "./AdminPlayers";
import AdminSessions from "./AdminSessions";
import AdminGroupSettings from "./AdminGroupSettings";

type Tab = "tx" | "players" | "sessions" | "group";

const TABS: { key: Tab; label: string }[] = [
  { key: "tx", label: "Ledger" },
  { key: "players", label: "Players" },
  { key: "sessions", label: "Sessions" },
  { key: "group", label: "Group" },
];

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>("tx");

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold" style={{ color: "rgb(var(--text-primary-rgb))" }}>House panel</h1>

      <div className="grid grid-cols-4 gap-1.5">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className="py-2 rounded-md text-xs font-bold transition-all active:scale-[0.98]"
            style={{
              background: tab === t.key ? "rgba(var(--color-primary-rgb),0.18)" : "rgb(var(--surface-raised-rgb))",
              color: tab === t.key ? "rgb(var(--color-primary-rgb))" : "rgb(var(--text-secondary-rgb))",
              border: `1px solid ${tab === t.key ? "rgba(var(--color-primary-rgb),0.7)" : "rgb(var(--border-rgb))"}`,
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "tx" && <AdminTransactions />}
      {tab === "players" && <AdminPlayers />}
      {tab === "sessions" && <AdminSessions />}
      {tab === "group" && <AdminGroupSettings />}
    </div>
  );
}
