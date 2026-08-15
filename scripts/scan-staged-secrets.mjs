#!/usr/bin/env node
/**
 * GokkeHub secret-scan gate.
 *
 * Runs as a Claude Code PreToolUse hook on `git commit` (see .claude/settings.json).
 * Scans the STAGED diff for high-signal secret leaks and, on a hit, emits a
 * PreToolUse "deny" so the commit tool call is blocked before it runs.
 *
 * It is intentionally precise (few false positives):
 *  - Supabase JWTs are decoded; only a `service_role` token blocks. The public
 *    `anon` key is allowed (it legitimately ships in client bundles).
 *  - Secret-shaped env assignments only fire when a real value follows `=`,
 *    so `.env.example` templates (empty values / comments) never trip it.
 *  - Staging a real `.env` / `.env.local` file is always blocked.
 *
 * Manual override: this hook only runs inside Claude Code. A human who truly
 * needs to commit a flagged line can do so with normal git outside the session.
 * Exit 0 always (the decision is carried in the JSON, not the exit code).
 */
import { execSync } from "node:child_process";

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    })
  );
  process.exit(0);
}

let stagedNames = "";
let diff = "";
try {
  stagedNames = execSync("git diff --cached --name-only", { encoding: "utf8" });
  diff = execSync("git diff --cached -U0", { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
} catch {
  // Not a git repo / nothing staged / git missing — nothing to gate, allow.
  process.exit(0);
}

const findings = [];

// 1) A real dotenv secret file staged (allow .env.example and *.sample).
for (const raw of stagedNames.split("\n")) {
  const f = raw.trim();
  if (!f) continue;
  const base = f.split("/").pop();
  if (/^\.env(\.[\w.-]+)?$/.test(base) && !/\.(example|sample|template)$/.test(base)) {
    findings.push(`staged secret file: ${f}`);
  }
}

// Only inspect ADDED lines from the diff body.
const added = diff
  .split("\n")
  .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
  .map((l) => l.slice(1));

// 2) Supabase / generic JWTs — decode payload, block only service_role.
const jwtRe = /eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{4,}/g;
for (const line of added) {
  for (const tok of line.match(jwtRe) || []) {
    let role = "";
    try {
      const payload = JSON.parse(Buffer.from(tok.split(".")[1], "base64url").toString("utf8"));
      role = payload.role || "";
    } catch {
      /* not a decodable JWT payload */
    }
    if (role === "service_role") findings.push("Supabase service_role JWT (server-only secret)");
    else if (role && role !== "anon") findings.push(`JWT with role="${role}"`);
    // role === "anon" → allowed (public key)
  }
}

// 3) Secret-shaped assignments with an actual value after = or :
const assignRe =
  /\b([A-Z0-9_]*(?:SERVICE_ROLE_KEY|CLIENT_SECRET|SESSION_SECRET|API_TOKEN|BOT_TOKEN|PRIVATE_KEY))\b\s*[:=]\s*['"]?([A-Za-z0-9._\-\/+]{12,})/;
for (const line of added) {
  const m = line.match(assignRe);
  if (m && !/(YOUR_|<|xxx|example|placeholder|process\.env|import\.meta|env\.)/i.test(m[2])) {
    findings.push(`hardcoded secret assignment: ${m[1]}=…`);
  }
}

// 4) Discord bot token shape (three dot-separated base64ish segments, first ~24+).
const discordRe = /\b[MN][A-Za-z0-9_-]{23,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{27,}\b/;
for (const line of added) {
  if (discordRe.test(line)) findings.push("possible Discord bot token");
}

if (findings.length) {
  const uniq = [...new Set(findings)];
  deny(
    "Commit blocked by GokkeHub secret-scan — the staged changes look like they contain secrets:\n" +
      uniq.map((f) => `  • ${f}`).join("\n") +
      "\n\nSecrets belong in Cloudflare Pages secrets or bots/musix-discord/.env (see .env.example), never committed. " +
      "Unstage the offending change (git restore --staged <file>) and try again."
  );
}

process.exit(0);
