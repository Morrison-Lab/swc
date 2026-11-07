#!/usr/bin/env python3
"""Find instructors' profile pages on WWU's department websites.

WWU's department sites list their people on a page reached from the site's
menu ("Directory", "People", "Faculty & Staff"), with each name linking to a
profile: mathematics.wwu.edu/people/noguchk, cs.wwu.edu/ahmeds,
chss.wwu.edu/sociology/people/seth-feinberg. The address scheme differs from
site to site, so this script reads the names, not the addresses.

It starts from the university's department directory
(www.wwu.edu/department-directory), opens each department site and the
people pages its menu links to, and keeps every same-site link whose text
reads as a person's name ("Amy Anderson, PhD"). It writes them to
data/raw/profiles.json as [name, url] pairs; build.py links an instructor
page to a profile whose name matches the instructor's Banner name.

Only the pages' public names and addresses are kept: no e-mail addresses,
phone numbers or photos.

Usage:
    python3 scraper/profiles.py
"""

from __future__ import annotations

import argparse
import html
import re
import sys
import time
from urllib.parse import urljoin, urlsplit

import requests

from scrape import RAW, USER_AGENT, dump_json, load_json

DIRECTORY = "https://www.wwu.edu/department-directory"
OUT = RAW / "profiles.json"
# Menu entries that lead to a site's list of people.
PEOPLE_MENU = re.compile(r"\b(directory|people|faculty|staff)\b", re.I)
# Menu entries that look like a people page but aren't one.
NOT_PEOPLE = re.compile(r"resources|positions|awards|ambassadors|affairs|senate|"
                        r"spotlight|focus|handbook|development|emerit|retired|"
                        r"research|log-in|login", re.I)
MAX_LIST_PAGES = 6  # people pages read per site
LINK = re.compile(r'<a\s[^>]*?href="([^"#]+)"[^>]*>(.*?)</a>', re.S | re.I)
# A person's name, optionally followed by degrees: "Amy Anderson, PhD".
NAME = re.compile(r"^([^\W\d_][\w'’.-]*(?: [^\W\d_][\w'’.-]*){1,4})(?:,? (?:[A-Z][A-Za-z.]{1,6},? ?)+)?$")


def text(fragment: str) -> str:
    return " ".join(html.unescape(re.sub(r"<[^>]+>", " ", fragment)).split())


class Site:
    def __init__(self, delay: float):
        self.delay = delay
        self.s = requests.Session()
        self.s.headers["User-Agent"] = USER_AGENT

    def get(self, url: str) -> tuple[str, str]:
        """(final url, html), or ("", "") for a missing or non-HTML page."""
        try:
            r = self.s.get(url, timeout=30)
        except requests.RequestException as e:
            print(f"  {url}: {e.__class__.__name__}", file=sys.stderr)
            return "", ""
        finally:
            time.sleep(self.delay)
        if not r.ok or "text/html" not in r.headers.get("content-type", ""):
            return "", ""
        return r.url, r.text


def roots(page: str) -> list[str]:
    """Department sites the directory links to: a host, or a host and the
    first path segment when the department lives under its college's site
    (chss.wwu.edu/sociology)."""
    out = set()
    for href, _ in LINK.findall(page):
        p = urlsplit(href.strip())
        if p.scheme not in ("http", "https") or not (p.hostname or "").endswith("wwu.edu"):
            continue
        seg = p.path.strip("/").split("/")[0]
        seg = "" if "." in seg else seg  # index.shtml and the like
        if p.hostname != "www.wwu.edu":  # the university's own front page
            out.add(f"https://{p.hostname}/")
        if seg:
            out.add(f"https://{p.hostname}/{seg}/")
    return sorted(out)


def inside(url: str, root: str) -> bool:
    return url.startswith(root)


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    p.add_argument("--delay", type=float, default=1.0,
                   help="seconds between requests (default 1)")
    args = p.parse_args()
    site = Site(args.delay)
    _, directory = site.get(DIRECTORY)
    if not directory:
        sys.exit(f"could not read {DIRECTORY}")
    found: dict[str, str] = {}  # url -> name
    for root in roots(directory):
        home_url, home = site.get(root)
        if not home or not inside(home_url, root.rstrip("/")):
            continue  # gone, or redirected to another site
        lists = {}
        for href, label in LINK.findall(home):
            url = urljoin(home_url, html.unescape(href))
            label = text(label)
            if (PEOPLE_MENU.search(label) and not NOT_PEOPLE.search(label + " " + url)
                    and inside(url, root) and url.rstrip("/") != home_url.rstrip("/")
                    and url not in lists and len(lists) < MAX_LIST_PAGES):
                lists[url] = None
        n = 0
        for url in lists:
            final, page = site.get(url)
            if not page:
                continue
            for href, label in LINK.findall(page):
                m = NAME.match(text(label))
                target = urljoin(final, html.unescape(href)).split("?")[0]
                if (m and inside(target, root) and target.rstrip("/") not in
                        (final.rstrip("/"), root.rstrip("/")) and target not in lists):
                    found.setdefault(target, m.group(1))
                    n += 1
        print(f"{root}: {len(lists)} people pages, {n} names", file=sys.stderr)
    if len(found) < len(load_json(OUT, [])) // 2:
        sys.exit(f"only {len(found)} profiles found, down from over twice that; "
                 "keeping the old file")
    dump_json(OUT, sorted([name, url] for url, name in found.items()))
    print(f"{len(found)} profiles -> {OUT}", file=sys.stderr)


if __name__ == "__main__":
    main()
