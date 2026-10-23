---
description: Set up a fork of claude-harness to contribute from, with origin as your fork and upstream as the owner's repo. Steps 1 and 2 of CONTRIBUTE.md.
disable-model-invocation: true
---

# ext-contribute-setup

Running this command is the instruction to fork and clone; it needs no further confirmation. Safe to run again.

## The pattern

- `upstream` is `alexander-kastil/claude-harness`, the owner's repo. Pull requests merge there.
- `origin` is your fork, `<you>/claude-harness`. You only ever push there.
- Remotes are recognised by their URL, never by their name.

## Never

- Push to the owner's repo.
- Remove or rename a remote that points to neither repo.
- Run in the owner's clone: when `gh api user --jq .login` is `alexander-kastil`, stop and say that the owner does not contribute through a fork.

## Steps

1. `gh auth status` must succeed. If it does not, hand over `gh auth login` for the contributor to run and stop. When `gh api user --jq .login` is `alexander-kastil`, stop (see Never).
2. Not inside a clone of claude-harness: `gh repo fork alexander-kastil/claude-harness --clone`, continue in the new `claude-harness` folder and skip to step 5.
3. Inside a clone whose `origin` is `alexander-kastil/claude-harness` (cloned from the owner, not from a fork): `gh repo fork --remote`. It creates the fork if needed, renames `origin` to `upstream` and adds the fork as `origin`.
4. Inside a clone of the fork without an `upstream` remote: `git remote add upstream https://github.com/alexander-kastil/claude-harness.git`.
5. `git fetch upstream`, then `git remote -v`: `origin` must be `<you>/claude-harness` and `upstream` must be `alexander-kastil/claude-harness`.
6. Report both remotes with their URLs, and that `/ext-contribute-start <name>` begins a change.
