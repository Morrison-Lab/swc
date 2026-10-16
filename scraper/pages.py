"""Static pages for the explorer: one per course and one per instructor.

build.py calls write_pages() with the same data it writes to courses.json.
Each course page lists every section of the course in the downloaded terms;
each instructor page lists every course and section they taught as instructor
of record. Instructors are matched by the name Banner shows, so two people
with the same name share a page.
"""

from __future__ import annotations

import json
import re
import shutil
import unicodedata
from collections import defaultdict
from html import escape
from pathlib import Path
from urllib.parse import quote

CATALOG_SEARCH = (
    "https://catalog.wwu.edu/search_advanced.php?cur_cat_oid=23&search_database=Search"
    "&search_db=Search&cpage=1&ecpage=1&ppage=1&spage=1&tpage=1&location=3&filter%5Bkeyword%5D=")
TEXTBOOKS_URL = "https://bookstore.wwu.edu/buy_textbooks.asp"
SUGGEST_URL = "https://github.com/Morrison-Lab/swc/issues/new?template=syllabus.yml&course="
BROWSE_URL = ("https://registration.banner.wwu.edu/StudentRegistrationSsb/ssb/"
              "term/termSelection?mode=search")


def e(s) -> str:
    return escape(str(s if s is not None else ""), quote=True)


def slugify(text: str) -> str:
    ascii_text = (unicodedata.normalize("NFKD", text)
                  .encode("ascii", "ignore").decode())
    return re.sub(r"[^A-Za-z0-9]+", "-", ascii_text).strip("-") or "x"


def unique_slugs(keys, lower: bool) -> dict[str, str]:
    """Map each key to a file-name slug, numbering any that collide."""
    out, used = {}, {"index"}  # instructor/index.html is the list page
    for k in sorted(keys):
        base = slugify(k)
        base = base.lower() if lower else base
        slug, n = base, 2
        while slug in used:
            slug, n = f"{base}-{n}", n + 1
        used.add(slug)
        out[k] = slug
    return out


def short_name(name: str) -> str:
    """'Last, First Middle' -> 'First Last'."""
    last, _, rest = (p.strip() for p in name.partition(","))
    return f"{rest.split()[0]} {last}" if rest else name


def fmt_time(t: str | None) -> str:
    if not t:
        return ""
    h, m = int(t[:2]), t[2:]
    return f"{h % 12 or 12}:{m}{'pm' if h >= 12 else 'am'}"


def meeting_text(m: list) -> str:
    days, begin, end, bldg, room = m
    when = (f"{days or ''} {fmt_time(begin)}{'-' + fmt_time(end) if end else ''}".strip()
            if days or begin else "TBA")
    where = " ".join(x for x in (bldg, room) if x)
    return f"{when} · {where}" if where else when


def page(title: str, description: str, body: str, scripts: str = "") -> str:
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{e(title)} · WWU Course Explorer</title>
  <meta name="description" content="{e(description)}">
  <link rel="icon" href="data:,">
  <link rel="stylesheet" href="../style.css">
  <script src="../theme.js"></script>
</head>
<body>
  <header class="top">
    <div class="wrap">
      <div>
        <p class="site-name"><a href="../index.html">WWU Course Explorer</a></p>
      </div>
      <div id="theme-slot"></div>
    </div>
  </header>
  <main class="wrap page">
    <p class="crumbs"><a href="../index.html">Search courses</a> · <a href="../instructor/index.html">All instructors</a></p>
{body}
  </main>
  <footer class="wrap foot">
    <p>
      Data from WWU's public <a href="{e(BROWSE_URL)}">Browse Classes</a>
      and the <a href="https://catalog.wwu.edu/">University Catalog</a>, refreshed automatically.
      Only each section's instructor of record is shown.
      Not an official WWU site; check Browse Classes before registering.
      <a href="https://github.com/Morrison-Lab/swc">Source</a>.
    </p>
  </footer>
{scripts}</body>
</html>
"""


def table(head: list[str], rows: list[str]) -> str:
    th = "".join(f"<th>{h}</th>" for h in head)
    return (f'<div class="table-scroll"><table>\n<thead><tr>{th}</tr></thead>\n'
            f'<tbody>\n{"".join(rows)}</tbody></table></div>')


def span(codes: list[str], term_names: dict[str, str]) -> str:
    """'Winter 2021 to Fall 2025' for a list of term codes."""
    first, last = min(codes), max(codes)
    if first == last:
        return term_names.get(first, first)
    return f"{term_names.get(first, first)} to {term_names.get(last, last)}"


def requisite_text(items: list[dict], link) -> str:
    """Banner's prerequisite terms as one line: 'CSCI 145 and (MATH 124 or ...)'.

    link(id) renders a course reference; terms Banner names but the explorer
    has no record of stay plain text. C- is Banner's usual minimum grade, so
    only other minimums are spelled out.
    """
    out = []
    for i, t in enumerate(items):
        word = f'{e(t["op"])} ' if i and t["op"] else ""
        name = link(t["id"]) if "id" in t else e(t.get("text", ""))
        grade = f' (minimum grade {e(t["grade"])})' if t["grade"] and t["grade"] != "C-" else ""
        out.append(f'{word}{"(" * t["open"]}{name}{grade}{")" * t["close"]}')
    # Grouping-only terms leave "( (" and "x )" behind; close them up.
    return re.sub(r"\s+\)", ")", re.sub(r"\(\s+", "(", " ".join(out)))


TREE_DEPTH = 6  # prerequisite chains rarely run deeper
LEADS_DEPTH = 3  # what a course leads to fans out fast


def tree(root: str, children, label, link, depth: int, short=None, *, anchor: str,
         also: str, converge: bool = False, open_levels: int = 99, count: str = "") -> str:
    """A foldable nested list of the courses within `depth` steps of `root`.

    Courses form a graph, not a tree: two branches can lead to the same
    course. Each course is expanded once, with label(), under the first
    parent that reaches it in the fewest steps, or with `converge`, under the
    parent on its longest path from `root`, so it sits where the last of its
    branches arrives. Its other parents list it with short() (label() if not
    given) and a link to that place, and the expanded entry names them after
    `also` ("also requires ..."), so the branches can be seen converging.
    A course with branches of its own is a <details> element, open on the
    first `open_levels` levels, its label followed by `count` with the
    number of branches filled in; `anchor` prefixes the entries' ids.
    """
    short = short or label
    # Breadth-first out to `depth`; every edge out of a course short of the
    # limit is kept.
    steps, home = {root: 0}, {}
    out, parents = defaultdict(list), defaultdict(list)
    queue = [root]
    for k in queue:  # grows as it goes
        if steps[k] >= depth:
            continue
        for c in dict.fromkeys(children(k)):
            out[k].append(c)
            if c != root:
                parents[c].append(k)
            if c not in steps:
                steps[c], home[c] = steps[k] + 1, k
                queue.append(c)
    if converge:
        # A topological order from a depth-first walk, which ignores the
        # edges that close a cycle; then each course's longest path.
        order, seen, stack = [], {root}, [(root, iter(out[root]))]
        while stack:
            k, it = stack[-1]
            c = next(it, None)
            if c is None:
                stack.pop()
                order.append(k)
            elif c not in seen:
                seen.add(c)
                stack.append((c, iter(out[c])))
        order.reverse()
        rank = {k: i for i, k in enumerate(order)}
        longest = {root: 0}
        for k in order:
            for c in out[k]:
                if rank[c] > rank[k] and longest[k] + 1 > longest.get(c, -1):
                    longest[c], home[c] = longest[k] + 1, k

    def ident(k: str) -> str:
        return f"{anchor}-{slugify(k)}"

    def walk(key: str, level: int) -> str:
        items = []
        for k in out[key]:
            if k == root:
                items.append(f"<li>{short(k)} <small>(this course)</small></li>")
                continue
            if home[k] != key:
                where = "" if home[k] == root else f" under {e(home[k])}"
                items.append(f'<li>{short(k)} <small>(<a href="#{ident(k)}">listed in full</a>'
                             f"{where})</small></li>")
                continue
            others = [p for p in parents[k] if p != key]
            note = (f'<br><small class="also">{also} {", ".join(link(p) for p in others)}</small>'
                    if others else "")
            sub_list = walk(k, level + 1)
            if sub_list:
                n = f' <small>({count.format(len(out[k]))})</small>' if count else ""
                items.append(f'<li id="{ident(k)}"><details{" open" if level <= open_levels else ""}>'
                             f"<summary>{label(k)}{n}{note}</summary>{sub_list}</details></li>")
            else:
                more = (" <small>(continues on its page)</small>"
                        if steps[k] >= depth and children(k) else "")
                items.append(f'<li id="{ident(k)}">{label(k)}{more}{note}</li>')
        return f"<ul>{''.join(items)}</ul>" if items else ""

    return walk(root, 1)


def write_pages(data: dict, site: Path) -> tuple[dict[str, str], dict[str, str]]:
    """Write site/course/*.html and site/instructor/*.html.

    Returns the course and instructor file-name slugs, for courses.json.
    """
    term_names = {t["code"]: t["name"] for t in data["terms"]}
    methods = data["methods"]
    courses = data["courses"]

    taught = defaultdict(list)  # instructor -> [(course, section)]
    for c in courses:
        for s in c["sections"]:
            for name in s["instr"]:
                taught[name].append((c, s))

    by_id = {c["id"]: c for c in courses}

    def pre_ids(k: str) -> list[str]:
        """The courses `k`'s prerequisites name, once each, in Banner's order."""
        return list(dict.fromkeys(t["id"] for t in by_id[k]["pre"] if "id" in t and t["id"] != k))

    def graph_ids(c: dict) -> bool:
        return bool(pre_ids(c["id"]) or c["requiredBy"])
    course_slug = unique_slugs([c["id"] for c in courses], lower=False)
    instr_slug = unique_slugs(taught, lower=True)

    def instr_link(name: str) -> str:
        return f'<a href="../instructor/{instr_slug[name]}.html">{e(name)}</a>'

    def course_link(c: dict) -> str:
        return f'<a href="../course/{course_slug[c["id"]]}.html">{e(c["id"])}</a>'

    def when(s: dict) -> str:
        return "<br>".join(e(meeting_text(m)) for m in s["mtg"]) or "TBA"

    def enrolled(s: dict) -> str:
        full = s["max"] and (s["enr"] or 0) >= s["max"]
        return (f'<td class="{"full" if full else "open"}">'
                f'{e(s["enr"] if s["enr"] is not None else "")}/{e(s["max"] if s["max"] is not None else "")}</td>')

    for sub in ("course", "instructor"):
        shutil.rmtree(site / sub, ignore_errors=True)
        (site / sub).mkdir(parents=True, exist_ok=True)

    # ---------- course pages ----------
    for c in courses:
        name = f'{c["id"]}: {c["title"] or "(untitled)"}'
        meta = [c["subjDesc"] or c["subj"],
                f'{c["cred"]} credit{"" if c["cred"] == "1" else "s"}' if c["cred"] else "",
                c["dept"] if c["dept"] and c["dept"] != c["subjDesc"] else ""]
        parts = [f"    <h1>{e(name)}</h1>",
                 f'    <p class="meta">{e(" · ".join(x for x in meta if x))}</p>']
        if c["desc"]:
            parts.append(f'    <p class="desc">{e(c["desc"])}</p>')
        if c["offered"]:
            n = len(c["offered"])
            parts.append(
                f'    <p>Offered in {n} of the {len(term_names)} listed terms '
                f'({e(span(c["offered"], term_names))}).</p>')
        else:
            parts.append("    <p>Not offered in the listed terms.</p>")
        links = [f'<a href="{e(CATALOG_SEARCH)}{e(c["id"]).replace(" ", "%20")}">Catalog entry</a>',
                 f'<a href="{e(BROWSE_URL)}">Browse Classes</a>',
                 f'<a href="{e(TEXTBOOKS_URL)}">Textbooks (WWU Bookstore)</a>']
        parts.append(f'    <p class="links">{"".join(links)}</p>')
        page_link = lambda k: course_link(by_id[k])  # noqa: E731
        titled = lambda k: f'{page_link(k)} <small>{e(by_id[k]["title"])}</small>'  # noqa: E731
        # In the prerequisite tree, each course also says how its own
        # prerequisites combine, since its branch lists them without and/or.
        needs = lambda k: titled(k) + (  # noqa: E731
            f'<br><small>requires {requisite_text(by_id[k]["pre"], e)}</small>'
            if by_id[k]["pre"] else "")
        req_term = term_names.get(c["preTerm"]) or c["preTerm"]
        parts.append("    <h2>Prerequisites</h2>")
        if c["pre"]:
            parts.append(f'    <p class="reqs">{requisite_text(c["pre"], page_link)}</p>')
            parts.append(f'    <details class="req-tree"><summary>Prerequisite tree</summary>'
                         f'<p><small>Each course\'s own prerequisites, down to the first courses in the chain. '
                         f'Click a course\'s arrow to fold or unfold its branch. A course that several '
                         f'branches need is listed in full once, where it is first reached, and linked from the others.</small></p>'
                         f'{tree(c["id"], pre_ids, needs, page_link, TREE_DEPTH, titled, anchor="pre", also="also a prerequisite for")}</details>')
        else:
            parts.append(f'    <p class="no-reqs">{"None that Banner enforces." if c["preTerm"] else "Not downloaded from Banner yet."}</p>')
        if c["co"]:
            parts.append("    <h2>Corequisites</h2>")
            parts.append(f'    <p class="reqs">{", ".join(page_link(t["id"]) if "id" in t else e(t["text"]) for t in c["co"])}</p>')
        if req_term:
            parts.append(f'    <p><small>From Banner\'s catalog for {e(req_term)}. Banner lists only the requisites it enforces, '
                         'so check the catalog entry too.</small></p>')
        parts.append(f'    <h2>Required by ({len(c["requiredBy"])})</h2>')
        if c["requiredBy"]:
            parts.append(f'    <p class="reqs">{", ".join(page_link(k) for k in c["requiredBy"])}</p>')
            parts.append(f'    <details class="req-tree"><summary>What it leads to</summary>'
                         f'<p><small>Courses that list it as a prerequisite, then the courses that list those, {LEADS_DEPTH} levels deep. '
                         f'Where branches converge, a course is listed in full once, under the last of its '
                         f'prerequisites to arrive, with the others it also requires named beneath it. '
                         f'Click a course\'s arrow to unfold its branch.</small></p>'
                         f'{tree(c["id"], lambda k: by_id[k]["requiredBy"], titled, page_link, LEADS_DEPTH, anchor="post", also="also requires", converge=True, open_levels=0, count="leads to {}")}</details>')
        else:
            parts.append('    <p class="no-reqs">No course lists it as a prerequisite.</p>')
        if graph_ids(c):
            parts.append('    <h2>Graph</h2>')
            parts.append(f'    <details class="req-graph" data-course="{e(c["id"])}"><summary>Prerequisites and what it leads to, as a graph</summary>'
                         '<p><small>Arrows run from a prerequisite to the course that requires it, so a course '
                         'with several arrows in is where branches converge. Click a course to fold or unfold its '
                         'branch (a dashed outline marks one with more to show); double-click to open its page. '
                         'Arrows do not show whether prerequisites are alternatives; the lists above do.</small></p>'
                         '<div class="graph-tools" hidden><button type="button" data-act="fit">Fit</button>'
                         '<button type="button" data-act="in">Zoom in</button><button type="button" data-act="out">Zoom out</button>'
                         '<button type="button" data-act="reset">Reset</button></div>'
                         f'<div class="graph-box" role="img" aria-label="Prerequisites of {e(c["id"])} and what it leads to, as a graph"></div>'
                         '<p class="graph-info" aria-live="polite"></p>'
                         '<noscript><p>The graph needs JavaScript.</p></noscript></details>')
        syl_links = []
        for syl in c["syllabi"]:
            bits = [syl["label"] or "Syllabus", syl.get("termName") or syl["term"],
                    syl["instructor"]]
            syl_links.append(f'<a href="{e(syl["url"])}">{e(" · ".join(b for b in bits if b))}</a>')
        syl_links.append(f'<a href="{e(SUGGEST_URL)}{e(quote(c["id"]))}">Suggest a syllabus link</a>')
        parts.append("    <h2>Syllabi and course websites</h2>")
        if not c["syllabi"]:
            parts.append('    <p class="no-syllabi">None listed yet.</p>')
        parts.append(f'    <p class="links">{"".join(syl_links)}</p>')

        if c["sections"]:
            by_instr = defaultdict(list)
            for s in c["sections"]:
                for i in s["instr"]:
                    by_instr[i].append(s["term"])
            if by_instr:
                rows = []
                for i, ts in sorted(by_instr.items(), key=lambda kv: (-len(kv[1]), kv[0])):
                    rows.append(f"<tr><td>{instr_link(i)}</td><td>{len(ts)}</td>"
                                f"<td>{e(span(ts, term_names))}</td></tr>\n")
                parts.append("    <h2>Instructors</h2>")
                parts.append(table(["Instructor", "Sections", "Terms"], rows))
            rows = []
            secs = sorted(c["sections"], key=lambda s: (s["term"], s["seq"]), reverse=True)
            for s in secs:
                title = f'<br><small>{e(s["title"])}</small>' if s["title"] else ""
                instr = "<br>".join(instr_link(i) for i in s["instr"]) or "Staff"
                rows.append(
                    f'<tr><td>{e(term_names.get(s["term"], s["term"]))}</td>'
                    f'<td>{e(s["seq"])}{title}</td><td>{e(s["crn"])}</td><td>{e(s["type"] or "")}</td>'
                    f'<td class="wrap-ok">{when(s)}</td><td class="wrap-ok">{instr}</td>'
                    f'{enrolled(s)}<td>{e(methods.get(s["method"]) or s["method"] or "")}</td></tr>\n')
            parts.append(f'    <h2>Every offering in the listed terms ({len(secs)} section{"" if len(secs) == 1 else "s"})</h2>')
            parts.append(table(["Term", "Sec", "CRN", "Type", "Meets", "Instructor",
                                "Enrolled", "Delivery"], rows))
        desc = f'When {c["id"]} has been offered at WWU and who taught it.'
        (site / "course" / f'{course_slug[c["id"]]}.html').write_text(
            page(name, desc, "\n".join(parts),
                 '  <script src="../reqs.js" defer></script>\n'), encoding="utf-8")

    # ---------- instructor pages ----------
    for name, pairs in taught.items():
        terms = [s["term"] for _, s in pairs]
        by_course = defaultdict(list)
        for c, s in pairs:
            by_course[c["id"]].append((c, s))
        parts = [f"    <h1>{e(short_name(name))}</h1>",
                 f'    <p class="meta">Listed in Banner as {e(name)}. '
                 "Sections are matched by this name, so two people who share it share this page.</p>",
                 f'    <p>{len(pairs)} section{"" if len(pairs) == 1 else "s"} of '
                 f'{len(by_course)} course{"" if len(by_course) == 1 else "s"} as instructor of record, '
                 f'{e(span(terms, term_names))}.</p>']
        rows = []
        for _, cs in sorted(by_course.items()):
            c = cs[0][0]
            ts = sorted({s["term"] for _, s in cs}, reverse=True)
            rows.append(
                f'<tr><td>{course_link(c)}</td><td class="wrap-ok">{e(c["title"])}</td>'
                f'<td>{len(cs)}</td>'
                f'<td class="wrap-ok">{e(", ".join(term_names.get(t, t) for t in ts))}</td></tr>\n')
        parts.append("    <h2>Courses</h2>")
        parts.append(table(["Course", "Title", "Sections", "Terms"], rows))
        rows = []
        for c, s in sorted(pairs, key=lambda p: (p[1]["term"], p[0]["id"], p[1]["seq"]),
                           reverse=True):
            rows.append(
                f'<tr><td>{e(term_names.get(s["term"], s["term"]))}</td><td>{course_link(c)}</td>'
                f'<td>{e(s["seq"])}</td><td>{e(s["crn"])}</td>'
                f'<td class="wrap-ok">{when(s)}</td>{enrolled(s)}'
                f'<td>{e(methods.get(s["method"]) or s["method"] or "")}</td></tr>\n')
        parts.append(f'    <h2>Every section in the listed terms ({len(pairs)})</h2>')
        parts.append(table(["Term", "Course", "Sec", "CRN", "Meets", "Enrolled", "Delivery"], rows))
        desc = f"Courses {short_name(name)} has taught at WWU, by term."
        (site / "instructor" / f"{instr_slug[name]}.html").write_text(
            page(short_name(name), desc, "\n".join(parts)), encoding="utf-8")

    # ---------- instructor index ----------
    rows = []
    for name in sorted(taught, key=lambda n: n.casefold()):
        pairs = taught[name]
        rows.append(f"<tr><td>{instr_link(name)}</td><td>{len({c['id'] for c, _ in pairs})}</td>"
                    f"<td>{len(pairs)}</td>"
                    f"<td>{e(span([s['term'] for _, s in pairs], term_names))}</td></tr>\n")
    body = ("    <h1>All instructors</h1>\n"
            f"    <p>{len(taught):,} instructors of record in the listed terms.</p>\n"
            + table(["Instructor", "Courses", "Sections", "Terms"], rows))
    (site / "instructor" / "index.html").write_text(
        page("All instructors", "Every WWU instructor of record in the explorer's terms.", body), encoding="utf-8")

    # ---------- requisite graph ----------
    # What reqs.js draws: each course's title, page and the courses on either
    # side of it, for every course with any.
    graph = {c["id"]: [c["title"], course_slug[c["id"]], pre_ids(c["id"]), c["requiredBy"]]
             for c in courses if graph_ids(c)}
    (site / "data").mkdir(parents=True, exist_ok=True)
    (site / "data" / "graph.json").write_text(
        json.dumps(graph, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    return course_slug, instr_slug
