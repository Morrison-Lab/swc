# CLAUDE.md

Read [AGENTS.md](AGENTS.md) first. [README.md](README.md) explains the
scraper, the build, and how the site is published.

Build the site locally with `python3 scraper/build.py`, then serve `site/`
(`python3 -m http.server -d site`).

## CI

`tests.yml` compiles the scripts and builds the index from the committed data.
`course-explorer.yml` refreshes the data from Banner daily and publishes `site/`
to GitHub Pages.
The rest are thin callers of reusable workflows in
[`Morrison-Lab/gha`](https://github.com/Morrison-Lab/gha).
All but one are pinned at `@v2` and copied from
`Morrison-Lab/teaching-tools`: `claude-review.yml` (automated PR review), `claude-bot.yml`
(`@claude` mentions), `check-secrets.yml` (gitleaks over the full history),
`check-typos.yml`, `check-junk-files.yml`, `lint-workflows.yml` (actionlint and zizmor,
configured by `.github/zizmor.yml`), and the warn-only `check-new-line-breaks.yml` and
`check-ai-tells.yml`.
The exception, `check-caller-permissions.yml`, is pinned at `@v3`, because its callee exists only from that tag.
It fails when a job here calls a `Morrison-Lab/gha` workflow without the permissions the callee requests.
`.github/dependabot.yml` keeps the action pins current.

`.claude/settings.json` enables the lab's `ai-config` plugin for Claude Code sessions here.
