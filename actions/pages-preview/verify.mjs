// Waits until Cloudflare says a Pages deployment is live, before anything announces it.
//
// wrangler (3 and 4) asks for a deployment's status five times (about 31 s). If Cloudflare
// hasn't answered success or failure by then, it prints "couldn't ascertain the final
// status", exits 0 and returns no alias. Trusting that exit code posted "Preview ready" for a
// deployment that never went live (garmin-map, 2026-11-09). So this step asks Cloudflare
// itself, for up to TIMEOUT_SECONDS, and fails the job unless the deployment is live.
//
// Pure parts are exported for tests/; main() runs only when this file is executed.
// Reads: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, PROJECT_NAME, DEPLOYMENT_ID,
//        GITHUB_OUTPUT. Writes alias-url to GITHUB_OUTPUT.
// Tests only, as arguments, never the environment: --api-url=, --timeout-seconds=,
// --interval-ms=. This step runs after the caller's build, which can write to $GITHUB_ENV;
// an environment variable could send the token to another host (decision 0011).
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { http, isDeploymentId } from "../pages-teardown/teardown.mjs";

export { isDeploymentId };
export const TIMEOUT_SECONDS = 180;
export const INTERVAL_MS = 5000;
export const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";

/**
 * A deployment's latest_stage as "live", "failed" or "pending".
 * Live only when the deploy stage itself succeeded: an earlier stage's success (a build, a
 * queue) is still pending. A stage that failed, was canceled or was skipped is final.
 */
export function stageVerdict(stage) {
  const name = stage?.name;
  const status = stage?.status;
  if (status === "failure" || status === "canceled" || status === "skipped") return "failed";
  if (name === "deploy" && status === "success") return "live";
  return "pending";
}

/** The deployment's *.pages.dev alias (the stable pr-<n> or pv-<hash> link), or "". */
export function pagesAlias(aliases) {
  if (!Array.isArray(aliases)) return "";
  const a = aliases.find((x) => typeof x === "string" && /^https:\/\/[^/]+\.pages\.dev\/?$/.test(x));
  return a ?? "";
}

/**
 * The poll's settings from the test-only arguments. Anything but a positive finite number
 * keeps the default: NaN would make the deadline never pass.
 */
export function pollSettings(argv = []) {
  const arg = (name) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const positive = (v, dflt) => {
    const n = Number(v);
    return v !== undefined && v !== "" && Number.isFinite(n) && n > 0 ? n : dflt;
  };
  return {
    apiUrl: arg("api-url") || CLOUDFLARE_API,
    timeoutMs: 1000 * positive(arg("timeout-seconds"), TIMEOUT_SECONDS),
    intervalMs: positive(arg("interval-ms"), INTERVAL_MS),
  };
}

/** Whether another wait still fits before the deadline. */
export function canWaitAgain(now, deadline, intervalMs) {
  return now + intervalMs <= deadline;
}

/** Text safe to print after a workflow command: a newline can't start another command. */
export function escapeCommand(text) {
  return String(text).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

// ---------------------------------------------------------------- I/O below

async function lastLogLine(base, token) {
  try {
    const r = await http(`${base}/history/logs`, { token });
    const data = r.json?.result?.data;
    return Array.isArray(data) && data.length ? String(data[data.length - 1]?.line ?? "") : "";
  } catch {
    return "";
  }
}

async function main(argv) {
  const e = process.env;
  for (const k of ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "PROJECT_NAME"]) {
    if (!e[k]) throw new Error(`${k} is empty or unset`);
  }
  if (!isDeploymentId(e.DEPLOYMENT_ID)) {
    throw new Error(`wrangler returned no deployment id (got ${JSON.stringify(e.DEPLOYMENT_ID ?? "")}); nothing to verify`);
  }
  const { apiUrl, timeoutMs, intervalMs } = pollSettings(argv);
  const base = `${apiUrl}/accounts/${e.CLOUDFLARE_ACCOUNT_ID}/pages/projects/${encodeURIComponent(e.PROJECT_NAME)}/deployments/${e.DEPLOYMENT_ID}`;
  const token = e.CLOUDFLARE_API_TOKEN;

  const deadline = Date.now() + timeoutMs;
  let last = "no answer yet";
  for (;;) {
    let r = null;
    try {
      r = await http(base, { token });
    } catch (err) {
      last = `request failed: ${err.message}`;
    }
    const result = r?.json?.success ? r.json.result : null;
    if (r && !result) last = `HTTP ${r.status}: ${JSON.stringify(r.json?.errors ?? r.text.slice(0, 300))}`;
    if (result) {
      const verdict = stageVerdict(result.latest_stage);
      last = `stage ${result.latest_stage?.name ?? "?"}: ${result.latest_stage?.status ?? "?"}`;
      if (verdict === "live") {
        if (e.GITHUB_OUTPUT) appendFileSync(e.GITHUB_OUTPUT, `alias-url=${pagesAlias(result.aliases)}\n`);
        console.log(`Cloudflare reports deployment ${e.DEPLOYMENT_ID} live (${last}).`);
        return;
      }
      if (verdict === "failed") {
        const line = await lastLogLine(base, token);
        throw new Error(`deployment ${e.DEPLOYMENT_ID} failed (${last})${line ? `: ${line}` : ""}`);
      }
    }
    if (!canWaitAgain(Date.now(), deadline, intervalMs)) break;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Cloudflare didn't report deployment ${e.DEPLOYMENT_ID} live within ${timeoutMs / 1000} s (last: ${last}). ` +
    "It may still finish; re-run the job rather than trust its link.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((err) => {
    console.log(`::error::${escapeCommand(`pages-preview verify: ${err.message}`)}`);
    process.exit(1);
  });
}
