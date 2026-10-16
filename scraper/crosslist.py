"""Cross-listed courses and courses taught at more than one level.

Banner lists a class taught under several codes once per code: GEOL 497T and
GEOL 597T, or ENRG 482 and ESCI 482, are one room, one instructor and one
meeting time. build.py calls link_courses() to find them, in two steps.

Sections are taught together when Banner puts them in one cross-list group
(its crossList code, per term), or when they have the same instructor and
the same scheduled meetings (days, times and room), which catches 400- and
500-level sections Banner doesn't group. Each section records the other
course codes it was taught with that term, whatever they are.

Courses are the same course when they were taught together in at least half
of the terms each was offered, under similar titles each time. That leaves
out special-topics numbers (HIST 490), which pair with a different course
from term to term, and classes that only share a room now and then. Two
undergraduate numbers in one subject are never one course: MUS 212, 312 and
412 (Applied Instruction: Piano) or JOUR 214, 314 and 414 (The Front Staff)
meet together but are taken in turn. Same-course codes form one group with a
canonical code, and every record keeps its own code, sections and page.
"""

from __future__ import annotations

import re
from collections import defaultdict

# Words that grad, honors and topics versions add to a title ("Advanced
# Limnology", "Seminar in Cost Management"), and filler.
IGNORED = {"a", "an", "and", "the", "of", "in", "to", "for", "on", "advanced",
           "adv", "applied", "introduction", "intro", "graduate", "grad",
           "seminar", "sem", "topics", "studies"}
# Words that tell levels of a course apart: Skiing I and II, Beginning and
# Intermediate Pilates. A title pair must agree on these.
LEVEL_WORDS = re.compile(r"\d+|[ivx]+|beginning|beginner|elementary|intermediate")


def words(title: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", title.casefold().replace("&", " and "))


def similar(a: str, b: str) -> float:
    """How much two titles share, from 0 to 1, abbreviations allowed.

    "Fourier Series/Differntl Eqns" matches "Fourier Series and
    Applications to Partial Differential Equations" in part; a word matches
    another it is a prefix of ("Sustain", "Sustainable").
    """
    wa = [w for w in words(a) if w not in IGNORED]
    wb = [w for w in words(b) if w not in IGNORED]
    level = lambda ws: {w for w in ws if LEVEL_WORDS.fullmatch(w)}  # noqa: E731
    if level(wa) != level(wb):
        return 0.0
    wa = [w for w in wa if w not in level(wa)]
    wb = [w for w in wb if w not in level(wb)]
    if not wa or not wb:
        return 1.0 if wa == wb else 0.0

    def found(w: str, ws: list[str]) -> bool:
        return any(x == w or (min(len(x), len(w)) >= 3 and (x.startswith(w) or w.startswith(x)))
                   for x in ws)

    return min(sum(found(w, wb) for w in wa) / len(wa),
               sum(found(w, wa) for w in wb) / len(wb))


def link_courses(courses: dict[str, dict]) -> list[list[str]]:
    """Set "with" on sections and "same" and "canon" on courses.

    Each section must carry Banner's crossList code as "xlist", which this
    removes. A section taught with other course codes that term lists them
    in "with". A course's "same" lists the other codes of the same course,
    canonical one first, and "canon" names the canonical code (its own when
    it has none): the lowest-level code, then one with a description, then
    the one offered most often. Returns the groups.
    """
    by_term = defaultdict(list)  # term -> [(course, section)]
    for c in courses.values():
        for s in c["sections"]:
            by_term[s["term"]].append((c, s))

    joint = defaultdict(set)  # (course, course) -> terms taught together
    titles = defaultdict(set)  # (course, course, term) -> (course, title)
    for term, pairs in by_term.items():
        parent = list(range(len(pairs)))

        def find(i: int) -> int:
            while parent[i] != i:
                parent[i] = parent[parent[i]]
                i = parent[i]
            return i

        first = {}
        for i, (_, s) in enumerate(pairs):
            keys = []
            if s.get("xlist"):
                keys.append(("x", s["xlist"]))
            if s["instr"] and any(m[0] and m[1] for m in s["mtg"]):
                keys.append(("m", tuple(s["instr"]), tuple(map(tuple, s["mtg"]))))
            for k in keys:
                if k in first:
                    parent[find(i)] = find(first[k])
                else:
                    first[k] = i
        groups = defaultdict(list)
        for i, pair in enumerate(pairs):
            groups[find(i)].append(pair)
        for members in groups.values():
            ids = sorted({c["id"] for c, _ in members})
            if len(ids) > 1:
                for c, s in members:
                    s["with"] = [k for k in ids if k != c["id"]]
            for a in ids:
                for b in ids:
                    if a < b:
                        joint[a, b].add(term)
                        titles[a, b, term].update(
                            (c["id"], s["title"] or c["title"])
                            for c, s in members if c["id"] in (a, b))
    for c in courses.values():
        for s in c["sections"]:
            s.pop("xlist", None)

    offered = {k: set(c["offered"]) for k, c in courses.items()}

    def same_course(a: str, b: str, ts: set[str]) -> bool:
        if 2 * len(ts) < max(len(offered[a]), len(offered[b])):
            return False
        for t in ts:
            pair = titles[a, b, t]
            if max(similar(x, y) for ka, x in pair if ka == a
                   for kb, y in pair if kb == b) < 0.5:
                return False
        return True

    def sequence(a: str, b: str) -> bool:
        """Two undergraduate numbers in one subject: a sequence such as
        MUS 212, 312 and 412 (Applied Instruction: Piano), not one course."""
        ca, cb = courses[a], courses[b]
        return (ca["subj"] == cb["subj"] and
                (ca["level"] or 0) < 500 and (cb["level"] or 0) < 500)

    group = {}  # course -> its group, a list shared by every member
    # The most often joined pairs first, so a group grows from its core.
    for (a, b), ts in sorted(joint.items(), key=lambda kv: (-len(kv[1]), kv[0])):
        if not same_course(a, b, ts):
            continue
        ga, gb = group.get(a, [a]), group.get(b, [b])
        if ga is gb or any(sequence(x, y) for x in ga for y in gb):
            continue
        ga.extend(gb)
        for k in ga:
            group[k] = ga

    rank = lambda k: (courses[k]["level"] is None, courses[k]["level"] or 0,  # noqa: E731
                      not courses[k]["desc"], -len(offered[k]), k)
    for c in courses.values():
        c["same"], c["canon"] = [], c["id"]
    out = []
    for ids in {id(g): g for g in group.values()}.values():
        ids.sort(key=rank)
        out.append(ids)
        for k in ids:
            courses[k]["same"] = [x for x in ids if x != k]
            courses[k]["canon"] = ids[0]
    return sorted(out)
