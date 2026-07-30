---
name: commit-mine
description: Commit and push ONLY the changes this agent made in this session, leaving every other working-tree change (from the user or from concurrent agents) untouched. Use whenever committing or pushing anything — end of a build session, user says commit/push/ship, or the auto-commit rule fires. Mandatory when multiple agents may share this working tree.
---

# Commit Mine — commit only your own work

Multiple Claude agents (and Luka) may be working in this repo at the same time,
sometimes in the same working tree. The working tree is shared state: some dirty
files are yours, some are not. You commit yours. Everyone else commits theirs.
This replaces any habit of `git add -A` — never sweep the whole tree.

## Protocol

1. **List your files.** From this session's own history, list every file you
   created or edited (Edit/Write calls, files your scripts generated). This list
   is the ONLY thing you may stage. Do not reconstruct it from `git status` —
   status shows everyone's changes, not yours.

2. **Survey the tree.** Run `git status --porcelain` and split it:
   - **Mine** — files on your list.
   - **Not mine** — everything else: other agents' edits, Luka's WIP, untracked
     files you didn't create. Do not stage, stash, restore, clean, or otherwise
     touch these. Their owner commits them.

3. **Check for co-edited files.** For each of your files, `git diff <file>` and
   confirm every hunk is yours. If a file also contains changes you did not make:
   - If the foreign hunks are cleanly separable, stage only yours:
     `git diff -- <file> > /tmp/f.patch`, delete the foreign hunks from the
     patch, then `git apply --cached /tmp/f.patch`.
   - If they are tangled together, leave the file uncommitted and tell Luka
     which file and why.

4. **Stage by explicit path.** `git add <file> <file> ...` only. Never
   `git add -A`, `git add .`, `git add -u`, or `git commit -a`. If your work
   spans unrelated features, stage and commit per feature.

5. **Commit.** Descriptive `feat:`/`fix:`/`chore:` message describing what YOU
   built this session, with a `Co-Authored-By:` trailer for the active model.

6. **Verify before pushing.** `git show --stat HEAD` must list only your files.
   `git status` must still show the not-mine changes sitting untouched in the
   working tree.

7. **Push with rebase-retry.** Other agents push to the same branch, so a plain
   push can be rejected:

   ```bash
   git push origin HEAD || (git pull --rebase --autostash && git push origin HEAD)
   ```

   `--autostash` protects other agents' uncommitted changes during the rebase.
   If the rebase conflicts, resolve only inside your own files; never resolve by
   discarding changes that are not yours.

8. **Report.** Tell Luka the commit hash and files, and list the files you left
   alone so it's clear they are still waiting on their owner.

## Hard rules

- Never `git add -A` / `git add .` / `git commit -a` in a shared tree.
- Never `git stash`, `git restore`, `git checkout -- <file>`, `git clean`, or
  `git reset --hard` on changes that are not yours — that destroys another
  agent's uncommitted work.
- Untracked files you didn't create are someone else's work in flight.
- If you are unsure whether a change is yours, it is not yours.
