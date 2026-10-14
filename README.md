# WWU Course Explorer

A search site for Western Washington University courses, modeled on 
[ExploreCourses](https://explorecourses.stanford.edu/).
Search by code, title, keyword, instructor or department,
filter by subject, term, level, attribute (GUR, writing proficiency, ...) and delivery mode,
and see every section of a course in the loaded terms, with its instructor, meeting times and enrollment.

## Data sources

| Source | What it gives | How |
|---|---|---|
| [Browse Classes](https://registration.banner.wwu.edu/StudentRegistrationSsb/ssb/term/termSelection?mode=search) (Ellucian Banner 9) | Sections for any term back to Fall 2002: instructor, times, rooms, enrollment, delivery, attributes; the course catalog with college, department and descriptions | Public JSON endpoints, no login |
| [University Catalog](https://catalog.wwu.edu/) (Acalog) | Official course pages | Linked from each course; the site blocks scripted requests, so it is not scraped |
| [`data/syllabi.csv`](data/syllabi.csv) | Syllabus and course-material links | Curated by hand |

WWU retired its TimeTable/ClassFinder on 2025-10-07; Browse Classes replaced it.

By default the scraper starts from Winter five calendar years before this one (Winter 2021
in 2026), set by `HISTORY_YEARS` in `scraper/scrape.py`. Terms already downloaded stay in the
cache, so the history grows from there rather than rolling forward.
Earlier terms are one flag away (`--since 201840`, or `--all-terms` for everything since 2002).
Past terms are downloaded once and then kept; the newest six are refreshed on every run.

### Privacy

Banner's public search has no student data beyond section enrollment counts.
The scraper keeps only each section's primary instructor (the instructor of record), by name.
It drops secondary instructors, who are often graduate teaching assistants,
and instructor e-mail addresses and Banner IDs.
A graduate student who is the instructor of record still appears, as on WWU's own Browse Classes.

## Run it locally

```sh
pip install requests
python3 scraper/scrape.py      # sections, catalog, descriptions -> data/raw/
python3 scraper/build.py       # -> site/data/courses.json, site/course/, site/instructor/
python3 -m http.server -d site 8000
```

Course descriptions are fetched one at a time, with a pause between requests, and cached in
`data/raw/descriptions.json`, which is committed, so a run fetches only courses missing from it.
`--max-descriptions N` caps that for a quick test.

## Publishing

[`.github/workflows/course-explorer.yml`](.github/workflows/course-explorer.yml)
re-scrapes daily, rebuilds, and deploys `site/` to GitHub Pages.
It needs **Settings > Pages > Source: GitHub Actions** turned on once.
Run it by hand from the Actions tab, optionally with a `since` term code to load more history.

Downloaded terms carry over between runs in the Actions cache, not in git.
If that cache is evicted (GitHub drops caches unused for 7 days),
the next run downloads the five years again, and terms older than that loaded by hand drop off the site
until a run with that `since` is repeated.
If a term's new download has under half the sections of the cached copy,
the scraper keeps the old copy, finishes the other terms, and then fails the run,
so a truncated schedule is never published.
If the drop is real, run the workflow by hand with **allow_shrink** checked.

## Adding syllabi

Add a row to [`data/syllabi.csv`](data/syllabi.csv):

```csv
course,term,instructor,url,label
BIOL 204,202640,"Doe, Jane",https://example.edu/biol204-syllabus.pdf,Syllabus
```

One row per link:

- `course`: the course as Banner writes it, subject and number (e.g. `EPI 204`).
- `term` (optional): the Banner term code (e.g. `202640` for Fall 2026).
- `instructor` (optional): whose syllabus it is.
- `url`: an `http://` or `https://` link; the build stops on anything else.
- `label` (optional): the link text, `Syllabus` if empty.

Keep the file plain CSV, with no comment lines, so GitHub shows it as a table.
Link only public pages, and nothing that names a student.

## Layout

- [`scraper/scrape.py`](scraper/scrape.py): downloads from Banner into `data/raw/`
- [`scraper/build.py`](scraper/build.py): merges sections, catalog, descriptions and syllabi into one index
- [`scraper/pages.py`](scraper/pages.py): writes a static page per course (every section it has had in the listed terms, and who taught it) and per instructor (every course and section they taught in those terms), plus an instructor list; instructors are matched by the name Banner shows
- [`site/`](site/): static page (`index.html`, `app.js`, `style.css`) searching the index in the browser with [MiniSearch](https://lucaong.github.io/minisearch/), and `theme.js`, the lab sites' Light / Off-white / Parchment / Dark theme menu (the choice is shared with them under `mln-theme`)
