"""Prerequisites and corequisites for the explorer, from data/raw/requisites.json.

scrape.py stores Banner's rows as it shows them, with subjects by name
("Computer Science"); build.py calls add_requisites() to turn them into
course IDs ("CSCI 145") wherever the subject and course are known, and to
record, for each course, the courses whose prerequisites name it.
"""

from __future__ import annotations

from collections import defaultdict


def add_requisites(courses: dict[str, dict], reqs: dict[str, dict]) -> None:
    """Set pre, preTerm, co and requiredBy on every course record.

    pre is a list of terms in Banner's order, each
    {"op": "and" | "or" | "", "open": n, "close": n, "id" or "text", "grade"},
    where open and close count the parentheses around it. co is a list of
    {"id"} or {"text"}. A course Banner names that the explorer has no record
    of keeps its name as text.
    """
    codes = {}  # subject name -> code
    for c in courses.values():
        if c["subjDesc"]:
            codes.setdefault(c["subjDesc"].casefold(), c["subj"])

    def ref(subject: str, num: str) -> dict:
        code = codes.get(subject.casefold())
        key = f"{code} {num}" if code else ""
        if key in courses:
            return {"id": key}
        return {"text": f"{code or subject} {num}".strip()}

    required_by = defaultdict(set)
    for key, c in courses.items():
        r = reqs.get(key) or {}
        c["preTerm"] = r.get("term", "")
        c["pre"], c["co"] = [], []
        for row in r.get("pre", []):
            if len(row) != 9:
                continue
            op, open_, test, score, subject, num, _level, grade, close = row
            if subject and num:
                item = ref(subject, num)
            elif test:
                # "Y" marks a pass/fail clearance rather than a score.
                item = {"text": f"{test}, score {score}" if score and score != "Y" else test}
            else:
                continue
            item.update(op=op.lower(), open=open_.count("("), close=close.count(")"),
                        grade=grade)
            c["pre"].append(item)
            if "id" in item and item["id"] != key:
                required_by[item["id"]].add(key)
        for row in r.get("co", []):
            if len(row) >= 2 and row[0] and row[1]:
                c["co"].append(ref(row[0], row[1]))
    for key, c in courses.items():
        c["requiredBy"] = sorted(required_by.get(key, ()))
