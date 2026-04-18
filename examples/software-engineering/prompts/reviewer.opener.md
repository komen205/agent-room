Kick off the campaign on {{cwd}}.

This turn, do ALL of:

1. **Triage scout inbox** at `<campaign-dir>/scout-findings/inbox/`. For each finding file, decide promote (→ backlog.md + move to `promoted/`) or discard (→ `discarded/` with a reason). Commit the batch.

2. **Read the backlog** at `<campaign-dir>/backlog.md`.

3. **Inventory open PRs** authored by you or the implementers in the target repo:

   ```
   gh pr list --state open --json number,title,url,updatedAt,reviewDecision,mergeable
   ```

   For each, check for unresolved review comments, failing CI, or staleness (>7 days). These "finish what we started" candidates are usually higher ROI than fresh work.

4. **Rank** the combined list (backlog + open PRs) by ROI = impact / hours. Ground your estimates in the codebase — use Grep/Read to check call-site counts, affected files, test coverage. Record the ranking in `task_plan.md`.

5. **Assign one item to `implementer-a`** and **one item to `implementer-b`** (parallel work). For each: title, 1-sentence why, 2-sentence scope. Prefer unblocking in-flight PRs over fresh work. Record assignments in `progress.md`.

Post the top-3 ranking and both assignments in chat (single message, `metadata.next: all`). Keep the message under 8 sentences — tables go in the plan files, not chat.
