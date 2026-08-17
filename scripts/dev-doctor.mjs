#!/usr/bin/env node
/**
 * GokkeHub local-dev preflight.
 *
 * Runs before `npm run dev:functions` (as a `pre` script) and can be run by hand:
 *
 *   node scripts/dev-doctor.mjs jeopardy
 *   node scripts/dev-doctor.mjs jeopardy --no-net    # skip the live Supabase probes
 *   node scripts/dev-doctor.mjs jeopardy --no-kill   # don't touch stale workerd procs
 *
 * Every check here exists because it cost someone real time. Testing a Pages
 * Functions app locally has a handful of failure modes that all surface as the
 * *same* useless symptom — a 500 from somewhere deep, or a UI that just says you
 * are signed out — so each check states the exact fix instead of the symptom.
 *
 * It never prints a secret: keys are reported as length + decoded JWT claims.
 *
 * Exit 1 = cannot work, the dev server should not start.
 * Exit 0 with WARN = will boot, but something is likely to confuse you later.
 *
 * Adding an app: give it an entry in APPS below. `devVars` lists what must be in
 * .dev.vars (`jwt` validates a Supabase token's role/project/expiry, `mirror`
 * asserts the matching VITE_* twin in .env). `owns` and `schema` are optional
 * live probes. Everything else is derived from the app's wrangler.toml.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const APPS = {
  jeopardy: {
    dir:  "apps/jeopardy",
    port: 8788,
    devVars: {
      SUPABASE_SERVICE_ROLE_KEY: { jwt: "service_role" },
      DEV_USER_ID:               { mirror: "VITE_DEV_USER_ID" },
      DEV_USER_NAME:             { mirror: "VITE_DEV_USER_NAME", optional: true },
    },
    // 0 rows here means every authoring route answers "Not your game" (403).
    owns:   { table: "jp_games", column: "host_id", idVar: "DEV_USER_ID", label: "games" },
    // Columns from migrations that must already be applied in Supabase.
    schema: [{ table: "jp_teams", column: "color", migration: "supabase-migration-005.sql" }],
  },
};

// ── output ───────────────────────────────────────────────────────────────────

let failed = 0;
let warned = 0;
const pass = (m) => console.log(`  ✓ ${m}`);
const warn = (m, fix) => { warned++; console.log(`  ! ${m}`); if (fix) console.log(`      ${fix}`); };
const fail = (m, fix) => { failed++; console.log(`  ✗ ${m}`);  if (fix) console.log(`      ${fix}`); };

// ── helpers ──────────────────────────────────────────────────────────────────

const readIf = (p) => (existsSync(p) ? readFileSync(p, "utf8") : null);

/** Minimal dotenv parse — enough for .dev.vars and Vite .env files. */
function parseEnv(text) {
  const out = {};
  for (const line of (text ?? "").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m || line.trimStart().startsWith("#")) continue;
    out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

/** A value still shaped like a template placeholder, e.g. <paste-the-key>. */
const isPlaceholder = (v) => !v || /^<.*>$/.test(v) || /^(YOUR_|xxx|changeme|placeholder)/i.test(v);

function decodeJwt(token) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try { return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")); } catch { return null; }
}

function sh(cmd) {
  try { return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return null; }
}

/**
 * Run a PowerShell snippet, whichever PowerShell this machine actually has.
 * Depending on how the shell was launched, `powershell` (5.1) may not be on
 * PATH while `pwsh` (7+) is, or vice versa — so resolve one once and reuse it.
 * Returns null if PowerShell can't be reached at all. Keep snippets free of
 * double quotes; they are passed through a nested -Command string.
 */
let PS;
function ps(script) {
  if (PS === undefined) {
    PS = null;
    for (const candidate of ["pwsh", "powershell", "powershell.exe"]) {
      if (sh(`${candidate} -NoProfile -Command "1"`) !== null) { PS = candidate; break; }
    }
  }
  return PS === null ? null : sh(`${PS} -NoProfile -Command "${script}"`);
}

/**
 * Kill a stale `workerd` still holding our port.
 *
 * Ctrl-C on wrangler can leave its workerd child alive, and Windows will let the
 * next instance bind the same port *alongside* it — so wrangler cheerfully
 * reports "Ready on :8788" while every request is served by the old process with
 * the old .dev.vars. Scoped to this port on purpose: running two apps' Functions
 * side by side is normal, and a blanket workerd kill would take out the other.
 */
function clearPort(port) {
  const win = process.platform === "win32";
  const raw = win
    ? ps(`(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue).OwningProcess`)
    : sh(`lsof -ti tcp:${port} -sTCP:LISTEN`);

  // A null here means we couldn't look, which is not the same as "nothing there".
  if (raw === null) {
    return warn(`could not check port ${port} (no ${win ? "PowerShell" : "lsof"} available)`,
                win ? `If wrangler ignores your .dev.vars edits: Get-Process workerd | Stop-Process -Force`
                    : `If wrangler ignores your .dev.vars edits: pkill -f workerd`);
  }

  const list = [...new Set(raw.split(/\s+/).filter(Boolean))];
  if (!list.length) return pass(`port ${port} is free`);

  for (const pid of list) {
    const name = (win
      ? ps(`(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).ProcessName`)
      : sh(`ps -p ${pid} -o comm=`)) ?? "";

    // Only ever reap our own dev servers — never something else that took the port.
    if (!/^(workerd|node)/i.test(name.trim())) {
      fail(`port ${port} is held by ${name.trim() || "an unknown process"} (pid ${pid})`,
           `Stop it, or start wrangler on another port.`);
      continue;
    }
    const killed = win
      ? ps(`Stop-Process -Id ${pid} -Force`) !== null
      : sh(`kill -9 ${pid}`) !== null;
    if (killed) warn(`killed stale ${name.trim()} (pid ${pid}) still holding port ${port}`);
    else fail(`could not kill pid ${pid} on port ${port}`, `Kill it manually, then retry.`);
  }
}

async function get(url, key) {
  const res = await fetch(url, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    signal:  AbortSignal.timeout(6000),
  });
  return { status: res.status, body: await res.text() };
}

// ── main ─────────────────────────────────────────────────────────────────────

const [, , appName, ...flags] = process.argv;
const app = APPS[appName];
if (!app) {
  console.error(`dev-doctor: unknown app "${appName ?? ""}". Known: ${Object.keys(APPS).join(", ")}`);
  process.exit(1);
}
const noNet  = flags.includes("--no-net");
const noKill = flags.includes("--no-kill");

const appDir  = join(ROOT, app.dir);
const devVars = parseEnv(readIf(join(appDir, ".dev.vars")));
const viteEnv = parseEnv(readIf(join(appDir, ".env")));

console.log(`\ndev-doctor: ${app.dir}\n`);

// 1. .dev.vars exists at all.
if (!existsSync(join(appDir, ".dev.vars"))) {
  fail(`${app.dir}/.dev.vars is missing`,
       `cp ${app.dir}/.dev.vars.example ${app.dir}/.dev.vars   then fill it in`);
} else {
  pass(".dev.vars found");
}

// 2. Required vars are present, filled in, and (for tokens) actually valid.
const supabaseUrl = (readIf(join(appDir, "wrangler.toml")) ?? "")
  .match(/^\s*SUPABASE_URL\s*=\s*["']([^"']+)["']/m)?.[1];
const projectRef = supabaseUrl ? new URL(supabaseUrl).hostname.split(".")[0] : null;

for (const [name, spec] of Object.entries(app.devVars)) {
  const value = devVars[name];

  if (isPlaceholder(value)) {
    if (spec.optional) warn(`${name} is unset (optional)`);
    else fail(`${name} is missing or still the placeholder in .dev.vars`,
              `Fill it in — see ${app.dir}/.dev.vars.example for where the real value lives.`);
    continue;
  }

  if (spec.jwt) {
    const claims = decodeJwt(value);
    if (!claims) {
      fail(`${name} is not a decodable JWT (length ${value.length})`, `Re-copy the key — it looks truncated.`);
      continue;
    }
    if (claims.role !== spec.jwt) {
      fail(`${name} has role "${claims.role}", expected "${spec.jwt}"`,
           claims.role === "anon" ? `That's the public anon key — you need the service-role one.` : null);
      continue;
    }
    if (projectRef && claims.ref && claims.ref !== projectRef) {
      fail(`${name} belongs to Supabase project "${claims.ref}", but wrangler.toml points at "${projectRef}"`);
      continue;
    }
    if (claims.exp && claims.exp * 1000 < Date.now()) {
      fail(`${name} expired on ${new Date(claims.exp * 1000).toISOString().slice(0, 10)}`);
      continue;
    }
    pass(`${name} valid (role=${claims.role}, project=${claims.ref ?? "?"}, length ${value.length})`);
  } else {
    pass(`${name} set`);
  }

  // 3. The client half. The session cookie can't reach localhost, so the browser
  //    relies on a VITE_ twin; if the two disagree the UI and the Functions
  //    disagree about who you are, and nothing says so out loud.
  if (spec.mirror) {
    const twin = viteEnv[spec.mirror];
    if (isPlaceholder(twin)) {
      fail(`${spec.mirror} is missing from ${app.dir}/.env`,
           `Add ${spec.mirror}=${name === "DEV_USER_ID" ? "<same value as DEV_USER_ID>" : "<same value>"} — without it the UI shows you signed out.`);
    } else if (twin !== value) {
      fail(`${spec.mirror} in .env does not match ${name} in .dev.vars`,
           `The Functions and the UI will disagree about who you are. Make them identical.`);
    } else {
      pass(`${spec.mirror} matches ${name}`);
    }
  }
}

// 4. Live probes: does the key actually work, does the schema match, and does
//    this dev identity own anything?
const key = devVars[Object.keys(app.devVars).find((n) => app.devVars[n].jwt) ?? ""];
if (!noNet && supabaseUrl && key && !isPlaceholder(key) && failed === 0) {
  try {
    const probe = await get(`${supabaseUrl}/rest/v1/${app.owns?.table ?? "pg_catalog"}?select=*&limit=1`, key);
    if (probe.status === 401) {
      fail(`Supabase rejected the key (401 ${probe.body.slice(0, 80)})`,
           `The key parses but isn't accepted — it was probably rotated. Copy the current one from the Supabase dashboard.`);
    } else if (probe.status >= 400) {
      warn(`Supabase probe returned ${probe.status}: ${probe.body.slice(0, 100)}`);
    } else {
      pass("Supabase accepts the service-role key");
    }

    for (const s of app.schema ?? []) {
      const r = await get(`${supabaseUrl}/rest/v1/${s.table}?select=${s.column}&limit=1`, key);
      if (r.status >= 400) {
        fail(`${s.table}.${s.column} is missing — migration not applied`,
             `Run ${app.dir}/${s.migration} in the Supabase SQL editor.`);
      } else {
        pass(`${s.table}.${s.column} exists (${s.migration} applied)`);
      }
    }

    if (app.owns) {
      const id = devVars[app.owns.idVar];
      const r  = await get(
        `${supabaseUrl}/rest/v1/${app.owns.table}?select=${app.owns.column}&${app.owns.column}=eq.${encodeURIComponent(id)}`, key);
      const mine = r.status < 400 ? JSON.parse(r.body).length : 0;
      if (mine > 0) {
        pass(`${app.owns.idVar} owns ${mine} ${app.owns.label}`);
      } else {
        const all = await get(`${supabaseUrl}/rest/v1/${app.owns.table}?select=${app.owns.column}`, key);
        const owners = all.status < 400
          ? [...new Set(JSON.parse(all.body).map((r2) => r2[app.owns.column]).filter(Boolean))]
          : [];
        warn(`${app.owns.idVar} owns 0 ${app.owns.label} — authoring routes will answer "Not your game" (403)`,
             owners.length
               ? `${app.owns.column} values that do own ${app.owns.label}: ${owners.slice(0, 5).join(", ")}`
               : `No ${app.owns.label} exist yet — create one and this check goes quiet.`);
      }
    }
  } catch (err) {
    warn(`could not reach Supabase (${err instanceof Error ? err.message : err}) — skipped live checks`,
         `Offline? Re-run with --no-net to silence this.`);
  }
}

// 5. The port, last: no sense reaping a server if the config above is broken.
if (!noKill && failed === 0) clearPort(app.port);

// ── verdict ──────────────────────────────────────────────────────────────────

console.log("");
if (failed) {
  console.log(`dev-doctor: ${failed} problem${failed > 1 ? "s" : ""} must be fixed before the dev server is usable.\n`);
  process.exit(1);
}
console.log(warned ? `dev-doctor: ready, with ${warned} warning${warned > 1 ? "s" : ""}.\n` : "dev-doctor: all clear.\n");
