// The one name of a branch preview (STANDARD.md rule 2): pv-<the first 12 hex digits of the
// branch name's sha256>. A pull request's preview is pr-<number>; a preview/** branch has no
// number, and its name can be long, while Cloudflare keeps 28 characters of a branch in the
// alias hostname (garmin-map #164). A hash is short, can never be main or pr-<n>, and is
// computed here for the teardown. The deploy computes it in bash before the build
// (pages-branch-preview.yml), so the build cannot change it; a test checks the two agree.
//
// Run as a script, it writes alias=<name> for $BRANCH to $GITHUB_OUTPUT.
import { createHash } from "node:crypto";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const PREVIEW_PREFIX = "preview/";

/** A branch the preview-only route serves: preview/ and a non-empty rest, no whitespace. */
export function isPreviewBranch(branch) {
  return typeof branch === "string" && branch.startsWith(PREVIEW_PREFIX)
    && branch.length > PREVIEW_PREFIX.length && !/\s/.test(branch);
}

export function previewAlias(branch) {
  if (!isPreviewBranch(branch)) throw new Error(`not a preview branch: ${JSON.stringify(branch)}`);
  return "pv-" + createHash("sha256").update(branch).digest("hex").slice(0, 12);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const alias = previewAlias(process.env.BRANCH);
    if (!process.env.GITHUB_OUTPUT) throw new Error("GITHUB_OUTPUT is empty or unset");
    appendFileSync(process.env.GITHUB_OUTPUT, `alias=${alias}\n`);
    console.log(`${process.env.BRANCH} deploys as ${alias}`);
  } catch (err) {
    console.error(`pages-branch-preview alias: ${err.message}`);
    process.exit(1);
  }
}
