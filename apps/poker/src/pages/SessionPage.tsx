import { useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Badge, Button, Input, Modal, Panel, useToast } from "@gokkehub/ui";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { useLiveSession } from "@/hooks/useLiveSession";
import { useUsernames } from "@/hooks/useUsernames";
import BountyPanel from "@/components/BountyPanel";
import { kr, krSigned, netColor } from "@/lib/format";
import type { GamePlayer, GameSession } from "@/lib/types";

export default function SessionPage() {
  const { id } = useParams<{ id: string }>();
  const { profile, isAdmin, activeGroup, balance } = useAuth();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const { session, players, loading } = useLiveSession(id);
  const usernames = useUsernames(activeGroup?.group_id);

  const me = useMemo(() => players.find((p) => p.user_id === profile?.id), [players, profile]);
  const isHost = session?.host_id === profile?.id;

  // Modals
  const [joinOpen, setJoinOpen] = useState(false);
  const [rebuyOpen, setRebuyOpen] = useState(false);
  const [cashoutOpen, setCashoutOpen] = useState(false);

  if (loading) return <p className="text-sm" style={{ color: "rgb(var(--text-muted-rgb))" }}>Loading…</p>;
  if (!session) return <p className="text-sm" style={{ color: "rgb(var(--text-muted-rgb))" }}>Session not found.</p>;

  const name = (uid: string | null) => (uid ? usernames[uid] ?? "—" : "—");

  // ── Recap ──
  if (session.status === "finished") {
    return <Recap players={players} name={name} onBack={() => navigate("/games")} />;
  }

  const activePlayers = players.filter((p) => !p.cashed_out_at);
  const cashedOut = players.filter((p) => p.cashed_out_at);

  return (
    <div className="space-y-5">
      {/* Header */}
      <Panel>
        <div className="flex items-center justify-between">
          <h1 className="font-display text-xl font-bold" style={{ color: "rgb(var(--text-primary-rgb))" }}>
            {name(session.host_id)}'s table
          </h1>
          <Badge variant={session.status === "lobby" ? "primary" : "host"}>
            {session.status === "lobby" ? "Registering" : "Live"}
          </Badge>
        </div>
        <p className="text-xs mt-2" style={{ color: "rgb(var(--text-muted-rgb))" }}>
          {session.bounty_enabled
            ? `Bounty game · Buy-in ${kr(session.min_buyin)} + bounty ${kr(session.bounty_buyin ?? 0)}`
            : `Buy-in ${kr(session.min_buyin)}–${kr(session.max_buyin)}`}
          {" · Rebuys "}{session.rebuys_enabled ? "on" : "off"}
        </p>
      </Panel>

      {/* Players */}
      <Panel>
        <p className="text-xs uppercase font-bold tracking-wider mb-3" style={{ color: "rgb(var(--text-muted-rgb))", letterSpacing: "0.08em" }}>
          At the table ({players.length})
        </p>
        {players.length === 0 ? (
          <p className="text-sm text-center py-2" style={{ color: "rgb(var(--text-muted-rgb))" }}>No one has bought in yet.</p>
        ) : (
          <div className="space-y-2">
            {[...activePlayers, ...cashedOut].map((p) => (
              <div key={p.id} className="flex items-center justify-between py-2" style={{ borderTop: "1px solid rgb(var(--border-rgb))" }}>
                <div className="flex items-center gap-2">
                  <span className="font-semibold" style={{ color: "rgb(var(--text-primary-rgb))" }}>{name(p.user_id)}</span>
                  {p.user_id === profile?.id && <Badge variant="primary">You</Badge>}
                  {p.cashed_out_at && <Badge variant="team" team="spectator">Out</Badge>}
                </div>
                <div className="text-right">
                  {p.cashed_out_at ? (
                    <span className="text-sm font-bold tnum" style={{ color: netColor(p.net_result) }}>{krSigned(p.net_result)}</span>
                  ) : (
                    <span className="text-sm font-bold tnum" style={{ color: "rgb(var(--text-secondary-rgb))" }}>in {kr(p.total_buyin)}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* Actions */}
      <div className="space-y-3">
        {/* Join — during registration (tournament lobby) or anytime in a cash game */}
        {!me && !(session.mode === "tournament" && session.status === "active") && (
          <Button fullWidth onClick={() => setJoinOpen(true)}>Join — buy in</Button>
        )}

        {/* Tournament lobby: host starts, registered players wait */}
        {session.status === "lobby" && (
          <>
            {(isHost || isAdmin) && (
              <Button fullWidth disabled={players.length < 2}
                onClick={async () => {
                  const { error } = await supabase.rpc("poker_start_session", { p_session: session.id });
                  if (error) addToast(error.message, "error");
                }}>
                Start tournament{players.length < 2 ? " (need 2+)" : ""}
              </Button>
            )}
            {me && !isHost && (
              <p className="text-center text-sm" style={{ color: "rgb(var(--text-muted-rgb))" }}>
                Registered for {kr(me.total_buyin)} — waiting for the host to start.
              </p>
            )}
          </>
        )}

        {/* Chop agreed (keep-stack): remaining players must cash out their chips */}
        {session.chop_agreed && me && !me.cashed_out_at && (
          <div className="p-3 rounded-md text-sm text-center" style={{ background: "rgba(var(--color-warning-rgb),0.12)", color: "rgb(var(--color-warning-rgb))", border: "1px solid rgba(var(--color-warning-rgb),0.4)" }}>
            Chop agreed — cash out your stack to finish.
          </div>
        )}

        {me && !me.cashed_out_at && session.status === "active" && (
          <>
            {session.rebuys_enabled && !session.bounty_enabled && (
              <Button variant="ghost" fullWidth onClick={() => setRebuyOpen(true)}>Rebuy</Button>
            )}
            {(session.allow_cashout !== false || session.chop_agreed) && (
              <Button fullWidth onClick={() => setCashoutOpen(true)}>Cash out</Button>
            )}
          </>
        )}

        {me?.cashed_out_at && (
          <Panel>
            <p className="text-xs uppercase font-bold tracking-wider" style={{ color: "rgb(var(--text-muted-rgb))", letterSpacing: "0.08em" }}>
              You’re out · your result
            </p>
            <p className="font-display font-bold tnum mt-1" style={{ fontSize: "var(--text-3xl)", color: netColor(me.net_result) }}>
              {krSigned(me.net_result)}
            </p>
            <p className="text-sm mt-1" style={{ color: "rgb(var(--text-muted-rgb))" }}>
              Bought in {kr(me.total_buyin)} · cashed out {kr(me.cashout_value)}
              {" · waiting for the others to finish"}
            </p>
          </Panel>
        )}

        {(isHost || isAdmin) && players.length === 0 && (
          <button className="block w-full text-center text-xs py-2" style={{ color: "rgb(var(--color-danger-rgb))" }}
            onClick={async () => {
              const { error } = await supabase.rpc("poker_delete_session", { p_session: session.id });
              if (error) { addToast(error.message, "error"); return; }
              navigate("/games");
            }}>
            Delete empty table
          </button>
        )}
      </div>

      {/* Mystery bounty side-pot */}
      <BountyPanel
        session={session}
        players={players}
        usernames={usernames}
        userId={profile!.id}
        canManage={isHost || isAdmin}
      />

      {joinOpen && (
        <JoinModal session={session} balance={balance}
          onClose={() => setJoinOpen(false)} addToast={addToast} />
      )}
      {rebuyOpen && me && (
        <RebuyModal sessionId={session.id} balance={balance}
          onClose={() => setRebuyOpen(false)} addToast={addToast} />
      )}
      {cashoutOpen && me && (
        <CashoutModal sessionId={session.id} me={me} userId={profile!.id}
          onClose={() => setCashoutOpen(false)} addToast={addToast} />
      )}
    </div>
  );
}

// ── Join ──
function JoinModal({ session, balance, onClose, addToast }: {
  session: GameSession;
  balance: number; onClose: () => void; addToast: (m: string, v?: "error" | "success" | "info") => void;
}) {
  const fixed = session.min_buyin === session.max_buyin;
  const bounty = session.bounty_enabled ? (session.bounty_buyin ?? 0) : 0;
  const [amount, setAmount] = useState(session.min_buyin);
  const [busy, setBusy] = useState(false);
  const total = amount + bounty;
  const tooPoor = balance < session.min_buyin + bounty;
  const valid = amount >= session.min_buyin && amount <= session.max_buyin && total <= balance;

  const submit = async () => {
    if (!valid) { addToast("Check the buy-in / your balance.", "error"); return; }
    setBusy(true);
    const { error } = await supabase.rpc("poker_join_session", { p_session: session.id, p_buyin: amount });
    setBusy(false);
    if (error) { addToast(error.message, "error"); return; }
    onClose();
  };

  return (
    <Modal open onClose={onClose}>
      <h2 className="font-display text-xl font-bold mb-1" style={{ color: "rgb(var(--text-primary-rgb))" }}>Buy in</h2>
      <p className="text-sm mb-4" style={{ color: "rgb(var(--text-muted-rgb))" }}>
        {fixed ? `Fixed buy-in ${kr(session.min_buyin)}` : `Range ${kr(session.min_buyin)}–${kr(session.max_buyin)}`} · Balance {kr(balance)}
      </p>
      {tooPoor ? (
        <p className="text-sm" style={{ color: "rgb(var(--color-danger-rgb))" }}>
          Your balance won’t cover the buy-in{bounty > 0 ? " + bounty" : ""}. Top up first.
        </p>
      ) : (
        <div className="space-y-4">
          {!fixed && (
            <Input label="Buy-in (kr)" type="number" inputMode="numeric" min={session.min_buyin} max={session.max_buyin}
              value={amount} onChange={(e) => setAmount(Math.max(0, parseInt(e.target.value || "0", 10)))} />
          )}
          {bounty > 0 && (
            <div className="text-sm space-y-1 p-3 rounded-md" style={{ background: "rgb(var(--surface-input-rgb))", border: "1px solid rgb(var(--border-rgb))" }}>
              <div className="flex justify-between"><span style={{ color: "rgb(var(--text-muted-rgb))" }}>Buy-in</span><span className="tnum" style={{ color: "rgb(var(--text-primary-rgb))" }}>{kr(amount)}</span></div>
              <div className="flex justify-between"><span style={{ color: "rgb(var(--text-muted-rgb))" }}>Bounty (required)</span><span className="tnum" style={{ color: "rgb(var(--text-primary-rgb))" }}>{kr(bounty)}</span></div>
              <div className="flex justify-between font-bold" style={{ borderTop: "1px solid rgb(var(--border-rgb))", paddingTop: 4 }}><span style={{ color: "rgb(var(--text-secondary-rgb))" }}>Total</span><span className="tnum" style={{ color: "rgb(var(--color-primary-rgb))" }}>{kr(total)}</span></div>
            </div>
          )}
          <Button fullWidth loading={busy} disabled={!valid} onClick={submit}>
            Sit down for {kr(total)}
          </Button>
        </div>
      )}
    </Modal>
  );
}

// ── Rebuy ──
function RebuyModal({ sessionId, balance, onClose, addToast }: {
  sessionId: string; balance: number; onClose: () => void;
  addToast: (m: string, v?: "error" | "success" | "info") => void;
}) {
  const [amount, setAmount] = useState(0);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (amount <= 0) return;
    if (amount > balance) { addToast("More than your balance.", "error"); return; }
    setBusy(true);
    const { error } = await supabase.rpc("poker_rebuy", { p_session: sessionId, p_amount: amount });
    setBusy(false);
    if (error) { addToast(error.message, "error"); return; }
    onClose();
  };
  return (
    <Modal open onClose={onClose}>
      <h2 className="font-display text-xl font-bold mb-1" style={{ color: "rgb(var(--text-primary-rgb))" }}>Rebuy</h2>
      <p className="text-sm mb-4" style={{ color: "rgb(var(--text-muted-rgb))" }}>Spendable balance {kr(balance)}</p>
      <div className="space-y-4">
        <Input label="Amount (kr)" type="number" inputMode="numeric" min={1} max={balance}
          value={amount || ""} onChange={(e) => setAmount(Math.max(0, parseInt(e.target.value || "0", 10)))} />
        <Button fullWidth loading={busy} disabled={amount <= 0 || amount > balance} onClick={submit}>
          Add {kr(amount)} to the table
        </Button>
      </div>
    </Modal>
  );
}

// ── Cashout (+ optional chip photo) ──
function CashoutModal({ sessionId, me, userId, onClose, addToast }: {
  sessionId: string; me: GamePlayer; userId: string; onClose: () => void;
  addToast: (m: string, v?: "error" | "success" | "info") => void;
}) {
  const [value, setValue] = useState<number | "">("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const net = value === "" ? null : Number(value) - me.total_buyin;

  const upload = async (file: File) => {
    setUploading(true);
    const ext = file.name.split(".").pop() || "jpg";
    const path = `${sessionId}/${userId}-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("poker-chips").upload(path, file, { upsert: true });
    if (error) { addToast("Photo upload failed: " + error.message, "error"); setUploading(false); return; }
    const { data } = supabase.storage.from("poker-chips").getPublicUrl(path);
    setPhotoUrl(data.publicUrl);
    setUploading(false);
  };

  const submit = async () => {
    if (value === "" || Number(value) < 0) return;
    setBusy(true);
    const { error } = await supabase.rpc("poker_cashout", {
      p_session: sessionId, p_cashout: Number(value), p_photo_url: photoUrl,
    });
    setBusy(false);
    if (error) { addToast(error.message, "error"); return; }
    onClose();
  };

  return (
    <Modal open onClose={onClose}>
      <h2 className="font-display text-xl font-bold mb-1" style={{ color: "rgb(var(--text-primary-rgb))" }}>Cash out</h2>
      <p className="text-sm mb-4" style={{ color: "rgb(var(--text-muted-rgb))" }}>
        You bought in for {kr(me.total_buyin)} total.
      </p>
      <div className="space-y-4">
        <Input label="Chip value you’re leaving with (kr)" type="number" inputMode="numeric" min={0}
          value={value} onChange={(e) => setValue(e.target.value ? Math.max(0, parseInt(e.target.value, 10)) : "")} />

        {net !== null && (
          <p className="text-sm font-bold tnum text-center" style={{ color: netColor(net) }}>
            Net result {krSigned(net)}
          </p>
        )}

        <div>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden"
            onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          <Button variant="ghost" fullWidth loading={uploading} onClick={() => fileRef.current?.click()}>
            {photoUrl ? "Photo attached ✓ — retake" : "Add chip-stack photo (optional)"}
          </Button>
          {photoUrl && <img src={photoUrl} alt="chip stack" className="mt-3 rounded-lg w-full object-cover max-h-48" />}
        </div>

        <Button fullWidth loading={busy} disabled={value === ""} onClick={submit}>Cash out</Button>
      </div>
    </Modal>
  );
}

// ── Recap ──
function Recap({ players, name, onBack }: {
  players: GamePlayer[]; name: (uid: string | null) => string; onBack: () => void;
}) {
  const potIn = players.reduce((s, p) => s + p.total_buyin, 0);
  const potOut = players.reduce((s, p) => s + (p.cashout_value ?? 0), 0);
  const balanced = potIn === potOut;
  const ranked = [...players].sort((a, b) => (b.net_result ?? 0) - (a.net_result ?? 0));
  const winner = ranked[0];
  const loser = ranked[ranked.length - 1];

  return (
    <div className="space-y-5">
      <div className="text-center">
        <h1 className="font-display text-2xl font-bold" style={{ color: "rgb(var(--text-primary-rgb))" }}>Game over</h1>
        <p className="text-sm mt-1" style={{ color: "rgb(var(--text-muted-rgb))" }}>Here’s how it shook out.</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Panel variant="bare" className="p-4 text-center">
          <p className="text-xs uppercase font-bold" style={{ color: "rgb(var(--text-muted-rgb))" }}>Highest earner</p>
          <p className="font-bold mt-1" style={{ color: "rgb(var(--text-primary-rgb))" }}>{winner ? name(winner.user_id) : "—"}</p>
          <p className="text-sm font-bold tnum" style={{ color: "rgb(var(--color-success-rgb))" }}>{krSigned(winner?.net_result ?? 0)}</p>
        </Panel>
        <Panel variant="bare" className="p-4 text-center">
          <p className="text-xs uppercase font-bold" style={{ color: "rgb(var(--text-muted-rgb))" }}>Biggest loser</p>
          <p className="font-bold mt-1" style={{ color: "rgb(var(--text-primary-rgb))" }}>{loser ? name(loser.user_id) : "—"}</p>
          <p className="text-sm font-bold tnum" style={{ color: "rgb(var(--color-danger-rgb))" }}>{krSigned(loser?.net_result ?? 0)}</p>
        </Panel>
      </div>

      <Panel>
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold" style={{ color: "rgb(var(--text-secondary-rgb))" }}>Pot in</span>
          <span className="font-bold tnum" style={{ color: "rgb(var(--text-primary-rgb))" }}>{kr(potIn)}</span>
        </div>
        <div className="flex items-center justify-between mt-2">
          <span className="text-sm font-semibold" style={{ color: "rgb(var(--text-secondary-rgb))" }}>Pot out</span>
          <span className="font-bold tnum" style={{ color: "rgb(var(--text-primary-rgb))" }}>{kr(potOut)}</span>
        </div>
        {!balanced && (
          <div className="mt-3 p-3 rounded-md text-sm font-semibold text-center"
            style={{ background: "rgba(var(--color-danger-rgb), 0.12)", color: "rgb(var(--color-danger-rgb))", border: "1px solid rgba(var(--color-danger-rgb),0.4)" }}>
            ⚠ Pot in and pot out don’t match (off by {kr(Math.abs(potIn - potOut))}). Double-check the chip counts.
          </div>
        )}
      </Panel>

      <Panel>
        <p className="text-xs uppercase font-bold tracking-wider mb-3" style={{ color: "rgb(var(--text-muted-rgb))", letterSpacing: "0.08em" }}>Results</p>
        <div className="space-y-2">
          {ranked.map((p) => (
            <div key={p.id} className="flex items-center justify-between py-2" style={{ borderTop: "1px solid rgb(var(--border-rgb))" }}>
              <span className="font-semibold" style={{ color: "rgb(var(--text-primary-rgb))" }}>{name(p.user_id)}</span>
              <div className="flex items-center gap-3">
                {p.chip_stack_photo_url && (
                  <a href={p.chip_stack_photo_url} target="_blank" rel="noreferrer" className="text-xs" style={{ color: "rgb(var(--color-primary-rgb))" }}>photo</a>
                )}
                <span className="text-sm font-bold tnum" style={{ color: netColor(p.net_result) }}>{krSigned(p.net_result)}</span>
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <Button variant="ghost" fullWidth onClick={onBack}>Back to games</Button>
    </div>
  );
}
