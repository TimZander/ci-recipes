// Where a branch preview's URL goes (STANDARD.md rule 3). There is no pull request to comment
// on, so the URL goes to the job's step summary, for a person, and to one stable line of the
// job's log, for an agent reading it through the API:
//
//   preview-url: <this commit's URL>
//
// Reads: DEPLOYMENT_URL, ALIAS_URL, BRANCH, HEAD_SHA, NOTE, GITHUB_STEP_SUMMARY.
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const URL_LINE = "preview-url: ";

/** The step summary. As in a PR's comment, the stable link only when Cloudflare returned one. */
export function summaryBody({ deploymentUrl, aliasUrl, branch, sha, note }) {
  if (!deploymentUrl) throw new Error("summaryBody: deploymentUrl is required");
  // A ref name may hold backticks and angle brackets: shown as plain characters only.
  const shown = String(branch ?? "").replace(/[^\w./-]/g, "_");
  const lines = [`**Preview ready** for \`${shown}\` at ${sha ? sha.slice(0, 7) : "this commit"}.`, ""];
  if (aliasUrl && aliasUrl !== deploymentUrl) {
    lines.push(`Stable link (always this branch's latest build; bookmark it): ${aliasUrl}`, "");
  }
  lines.push(`This commit: ${deploymentUrl}`);
  if (note && note.trim()) lines.push("", `_${note.trim()}_`);
  lines.push("", "Deleting the branch deletes the preview.");
  return lines.join("\n") + "\n";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const e = process.env;
    const body = summaryBody({
      deploymentUrl: e.DEPLOYMENT_URL, aliasUrl: e.ALIAS_URL, branch: e.BRANCH, sha: e.HEAD_SHA, note: e.NOTE,
    });
    if (e.GITHUB_STEP_SUMMARY) appendFileSync(e.GITHUB_STEP_SUMMARY, body);
    console.log(URL_LINE + e.DEPLOYMENT_URL);
    if (e.ALIAS_URL && e.ALIAS_URL !== e.DEPLOYMENT_URL) console.log(`preview-alias-url: ${e.ALIAS_URL}`);
  } catch (err) {
    console.error(`pages-branch-preview summary: ${err.message}`);
    process.exit(1);
  }
}
