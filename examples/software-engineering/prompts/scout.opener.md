Start the initial sweep on {{cwd}}.

Pick ONE hunting pattern (type erosion, duplicated boilerplate, API inconsistency, dead code, perf issue). Run the scan now — Grep/Glob + Read the relevant files, count call sites.

For each real finding, write a standalone Markdown file under `<campaign-dir>/scout-findings/inbox/<YYYYMMDD-HHMMSS>-<slug>.md` following the template in your system prompt (Summary, Evidence, Blast radius, Proposed fix location, Effort, Impact, Owner suggestion, Sweep).

Commit and push the new inbox files. Then post a 3-5 sentence summary addressed to the reviewer:
- Pattern chosen.
- N findings filed.
- Top 1-2 slugs with a one-line why.

The reviewer will triage and promote the worthy ones.
