// Waits until Cloudflare says a Pages deployment is live, before anything announces it.
//
// wrangler 3 asks for a deployment's status five times (about 31 s). If Cloudflare hasn't
// answered success or failure by then, it prints "couldn't ascertain the final status",
// exits 0 and returns no alias. Trusting that exit code posted "Preview ready" for a
// deployment that never went live (garmin-map, 2026-11-09). So this step asks Cloudflare
// itself, for up to TIMEOUT_SECONDS, and fails the job unless the deployment is live.
//
// Pure parts are exported for tests/; main() runs only when this file is executed.
// Reads: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, PROJECT_NAME, DEPLOYMENT_ID,
//        GITHUB_OUTPUT, and CLOUDFLARE_API_URL, VERIFY_TIMEOUT_SECONDS, VERIFY_INTERVAL_MS
//        (tests only). Writes alias-url to GITHUB_OUTPUT.
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { isDeploymentId } from "../pages-teardown/teardown.mjs";

export { isDeploymentId };
export const TIMEOUT_SECONDS = 180;
export const INTERVAL_MS = 5000;

/**
 * A deployment's latest_stage as "live", "failed" or "pending".
 * Live only when the deploy stage itself succeeded: an earlier stage's success (a build, a
 * queue) is still pending. Any stage that failed or was canceled is final.
 */
export function stageVerdict(stage) {
  const name = stage?.name;
  const status = stage?.status;
  if (status === "failure" || status === "canceled") return "failed";
  if (name === "deploy" && status === "success") return "live";
  return "pending";
}

/** The deployment's *.pages.dev alias (the stable pr-<n> or pv-<hash> link), or "". */
export function pagesAlias(aliases) {
  if (!Array.isArray(aliases)) return "";
  const a = aliases.find((x) => typeof x === "string" && /^https:\/\/[^/]+\.pages\.dev\/?$/.test(x));
  return a ?? "";
}

// ---------------------------------------------------------------- I/O below

async function cfGet(url, token) {
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* reported by the caller */ }
  return { ok: res.ok, status: res.status, json, text };
}

async function lastLogLine(base, token) {
  try {
    const r = await cfGet(`${base}/history/logs`, token);
    const data = r.json?.result?.data;
    return Array.isArray(data) && data.length ? String(data[data.length - 1]?.line ?? "") : "";
  } catch {
    return "";
  }
}

async function main() {
  const e = process.env;
  for (const k of ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "PROJECT_NAME"]) {
    if (!e[k]) throw new Error(`${k} is empty or unset`);
  }
  if (!isDeploymentId(e.DEPLOYMENT_ID)) {
    throw new Error(`wrangler returned no deployment id (got ${JSON.stringify(e.DEPLOYMENT_ID ?? "")}); nothing to verify`);
  }
  const timeoutMs = 1000 * Number(e.VERIFY_TIMEOUT_SECONDS || TIMEOUT_SECONDS);
  const intervalMs = Number(e.VERIFY_INTERVAL_MS || INTERVAL_MS);
  const cfApi = e.CLOUDFLARE_API_URL || "https://api.cloudflare.com/client/v4";
  const base = `${cfApi}/accounts/${e.CLOUDFLARE_ACCOUNT_ID}/pages/projects/${encodeURIComponent(e.PROJECT_NAME)}/deployments/${e.DEPLOYMENT_ID}`;

  const deadline = Date.now() + timeoutMs;
  let last = "no answer yet";
  for (;;) {
    let r = null;
    try {
      r = await cfGet(base, e.CLOUDFLARE_API_TOKEN);
    } catch (err) {
      last = `request failed: ${err.message}`;
    }
    if (r) {
      const result = r.json?.success ? r.json.result : null;
      if (!result) {
        last = `HTTP ${r.status}: ${JSON.stringify(r.json?.errors ?? r.text.slice(0, 300))}`;
      } else {
        const verdict = stageVerdict(result.latest_stage);
        last = `stage ${result.latest_stage?.name ?? "?"}: ${result.latest_stage?.status ?? "?"}`;
        if (verdict === "live") {
          const alias = pagesAlias(result.aliases);
          if (e.GITHUB_OUTPUT) appendFileSync(e.GITHUB_OUTPUT, `alias-url=${alias}\n`);
          console.log(`Cloudflare reports deployment ${e.DEPLOYMENT_ID} live (${last}).`);
          return;
        }
        if (verdict === "failed") {
          const line = await lastLogLine(base, e.CLOUDFLARE_API_TOKEN);
          throw new Error(`deployment ${e.DEPLOYMENT_ID} failed (${last})${line ? `: ${line}` : ""}`);
        }
      }
    }
    if (Date.now() + intervalMs > deadline) break;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Cloudflare didn't report deployment ${e.DEPLOYMENT_ID} live within ${timeoutMs / 1000} s (last: ${last}). ` +
    "It may still finish; re-run the job rather than trust its link.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.log(`::error::pages-preview verify: ${err.message}`);
    process.exit(1);
  });
}
