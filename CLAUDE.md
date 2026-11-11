# CLAUDE.md

Read [AGENTS.md](AGENTS.md) first. [README.md](README.md) explains the
scraper, the build, and how the site is published.

Build the site locally with `python3 scraper/build.py`, then serve `site/`
(`python3 -m http.server -d site`).

A fresh checkout builds no courses: only the description, attribute and
requisite seeds are committed, and sections take hours to scrape from Banner.
To test course pages or `site/` scripts against real data, download the
published index (`https://morrison-lab.github.io/swc/data/courses.json`, the
same shape `build.py` writes) and pass it to `pages.write_pages(data, site_dir)`
with a scratch copy of `site/` as `site_dir`.
The same index answers catalog questions faster than catalog.wwu.edu:
regex over each course's `title`, `desc` and `sections[].title` to find courses on a topic,
then read its `offered` term codes (named in the top-level `terms`) for when it last ran.
The index starts at its earliest `terms` entry (Winter, `HISTORY_YEARS` calendar years back; see `scraper/scrape.py`),
so an empty `offered` means "not offered since then", not "never offered".
Section titles carry topics-course and HNRS 350 seminar names that the catalog omits.
In Playwright, route `cdn.jsdelivr.net` to local copies of the pinned files
(their SRI hashes still match) if the browser cannot reach the CDN.

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

In a cloud session, TLS to `*.wwu.edu` (Banner and the department sites)
fails: the container's CA store lacks the emSign root WWU's chain ends in.
`pip download certifi`, unzip it, concatenate its `cacert.pem` with the
session's proxy bundle, and point `REQUESTS_CA_BUNDLE` at the result;
never turn verification off.
