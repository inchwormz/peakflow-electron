# Agent rules

Codex and Claude agents read this file. John's global rules are in `~/.codex/AGENTS.md` on his Mac.

## Copy rule: the full style-corpus-writer route

Source: John, 2026-10-29: "everything must rigidly go through style corpus writer it needs to be a agents.md rule". The steps below are agent-worded from that request (coordinator brief, 2026-10-29). The one source is `~/.codex/AGENTS.md`; repo AGENTS.md files carry a mirror, so change them together.

- **What it covers:** any text written for readers outside John and his agents. That includes site pages, blog posts, guides, comparison pages, directory and store listings, launch posts, customer emails, ad copy, app UI copy (labels, buttons, errors, empty states, onboarding), SEO and social metadata, alt text, release notes, and translations of any of these. It does not cover code identifiers, logs, or notes for John or agents.
- **The full route:** read `~/.claude/skills/style-corpus-writer/SKILL.md`, use the Precise Hierarchical Plain profile for product and business copy (John's own X and LinkedIn posts use the casual social profile instead, with that profile's exclusions), read the original corpus passages the profile requires, then follow the Draft and Review Loop and Editorial Acceptance. Checking only the banned-word list does not count.
- **Copy cannot ship without a `copy-acceptance/<YYYY-MM-DD>-<slug>/` folder, committed in the same PR** (at the repo root). For copy that never goes through a repo, such as an email, a CMS field or a social post, save the folder under `~/Work/<product>/docs/copy-acceptance/` before sending or publishing. The folder holds:
  1. **`draft.md`:** the exact final copy. For UI strings, list each string with its file or field and the surrounding text a reader sees beside it. For a large page, cover every changed string; split into several drafts if needed, with none left out.
  2. **Passing verify-draft runs**, after the last edit. From `~/.claude/skills/style-corpus-writer`, run `node scripts/verify-draft.mjs --profile .firecrawl/style-profiles/<author>/style-profile.json --draft "<absolute path to draft.md>" --out "<absolute path to folder>/verify-<author>.json"` for each of `barbara-minto`, `bertrand-russell` and `george-orwell`. Each must exit 0 with `"ok": true`. If a hit is a justified literal use the skill allows (an accurate quotation, an official name, a code identifier), keep the failing JSON and explain it under "Checker exceptions" in the record; anything else gets reworded. John's casual social posts skip these runs and say so in the record. The checker reads English only, so run it on the English source; translations get the editorial review in their own language, recorded in the same file.
  3. **`ACCEPTANCE.md`:** which copy changed and where (files, fields, locales), the profile used, the corpus passages read (file, section and the technique used), each Editorial Acceptance condition with "pass" or the fix made, the `shasum -a 256` of each `draft.md`, and any checker exceptions.
- **Reviewers and mergers must reject** a PR that adds or changes visible copy when the folder is missing, `draft.md` does not match the shipped copy or its hash, a required verify run (item 2) is missing or fails without a valid exception, or any Editorial Acceptance condition is left unresolved. Where item 2 requires them, re-run the three verify commands yourself before approving; they take seconds. Copy-only PRs still need no code review (see Review effort), but whoever merges or builds the train makes this check first.
- If the skill folder is not on your machine (for example a cloud agent), do not ship the copy: hand it to an agent on John's Mac.

## Bug triage: blocker or issue

Source: John, 2026-10-29: "can you put this agents.md for whether or not a bug is a blocker. Rate each bug from 1 to 10 on how often it would happen and how bad it would be. If the two scores multiplied are below 5, just file it as an issue and leave the code alone." Lines marked (agent-added) are clarifications from the coordinator brief of the same day, not John's words. The one source is `~/.codex/AGENTS.md`; repo AGENTS.md files carry a mirror, so change them together.

- Score every bug, including each code-review and QA finding, from 1 to 10 on **how often** it would happen and 1 to 10 on **how bad** it would be. Multiply the two.
- **Below 5: not a blocker.** File it as an issue and leave the code alone. Do not fix it in the current change, and do not hold a merge or release for it.
- **5 or more:** it is a blocker, handled under the normal review and release rules.
- (agent-added) Score how bad honestly. Security holes, lost money, lost data and locked-out users belong at the top of that scale; a rare bug of that kind is not waved through by its frequency alone.
- (agent-added) Reviewers write both scores and the product beside each finding, for example `often 2 x bad 2 = 4, issue`. In a review ledger a below-5 finding is closed as WONTFIX/OUT-OF-SCOPE with its issue link.
- (agent-added) Where to file: Linear (team SIT). Linear is at its free-plan issue limit, so when it refuses, open a GitHub issue on the repo (`gh issue create`) and name the issue in the PR or report.
- (agent-added) This rule decides whether a bug blocks. "Review effort matches risk" still decides how much review a change gets.
