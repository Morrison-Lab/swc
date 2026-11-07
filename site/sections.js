/* Instructor pages: sort the sections table and fold it over terms or courses.
 *
 * scraper/pages.py writes one row per section, with the term, course, title
 * and enrollment in data-* attributes. Clicking a column heading sorts by that
 * column (again to reverse). "Combine terms" folds each course's sections into
 * one row, "Combine courses" folds each term's, and both give a single total.
 * Scraped text reaches the page through textContent, never as HTML.
 */
(() => {
  "use strict";

  const table = document.getElementById("sections");
  const tools = document.getElementById("section-tools");
  if (!table || !tools) return;
  const thead = table.tHead;
  const tbody = table.tBodies[0];
  const original = { head: thead.innerHTML, rows: [...tbody.rows] };
  const sections = original.rows.map((tr) => ({
    term: tr.dataset.term, termName: tr.dataset.termName,
    course: tr.dataset.course, href: tr.dataset.href, title: tr.dataset.title,
    enr: tr.dataset.enr === "" ? null : Number(tr.dataset.enr),
    max: tr.dataset.max === "" ? null : Number(tr.dataset.max),
  }));
  let sortCol = -1, sortDir = 1;

  // ---------- controls ----------
  tools.className = "section-tools";
  const box = (label) => {
    const l = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    l.append(input, ` ${label}`);
    tools.append(l);
    // Each view has its own columns, so a change of view drops the sort.
    input.addEventListener("change", () => { sortCol = -1; render(); });
    return input;
  };
  const byTerms = box("Combine terms");
  const byCourses = box("Combine courses");

  // ---------- cells ----------
  const cell = (text, sort) => {
    const td = document.createElement("td");
    td.textContent = text;
    if (sort !== undefined) td.dataset.sort = sort;
    return td;
  };
  const link = (s) => {
    const a = document.createElement("a");
    a.href = s.href;
    a.textContent = s.course;
    return a;
  };
  const courseCell = (list) => {
    const td = document.createElement("td");
    td.className = "wrap-ok";
    list.forEach((s, i) => td.append(...(i ? [", ", link(s)] : [link(s)])));
    td.dataset.sort = list.map((s) => s.course).join(", ");
    return td;
  };
  const enrolled = (list) => {
    const known = list.filter((s) => s.enr !== null);
    const enr = known.reduce((n, s) => n + s.enr, 0);
    const max = list.reduce((n, s) => n + (s.max || 0), 0);
    return cell(known.length ? `${enr}/${max}` : "", known.length ? enr : "");
  };
  const span = (list) => {
    const terms = [...new Map(list.map((s) => [s.term, s.termName])).entries()].sort();
    const first = terms[0], last = terms[terms.length - 1];
    return cell(first[0] === last[0] ? first[1] : `${first[1]} to ${last[1]}`, first[0]);
  };
  const uniq = (list, key) => [...new Map(list.map((s) => [s[key], s])).values()];

  // ---------- rows ----------
  function grouped(key) {
    const groups = new Map();
    sections.forEach((s) => {
      const k = key(s);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(s);
    });
    return [...groups.values()];
  }

  function build() {
    if (!byTerms.checked && !byCourses.checked) {
      return { head: null, rows: original.rows };
    }
    let head, rows;
    if (byTerms.checked && byCourses.checked) {
      head = ["Terms", "Courses", "Sections", "Enrolled"];
      const courses = uniq(sections, "course").sort((a, b) => a.course.localeCompare(b.course));
      rows = [[span(sections), courseCell(courses),
        cell(String(sections.length), sections.length), enrolled(sections)]];
    } else if (byTerms.checked) {
      head = ["Course", "Title", "Sections", "Terms", "Enrolled"];
      rows = grouped((s) => s.course).map((list) => {
        const terms = uniq(list, "term").sort((a, b) => b.term.localeCompare(a.term));
        const t = cell(terms.map((s) => s.termName).join(", "), terms[0].term);
        t.className = "wrap-ok";
        const title = cell(list[0].title);
        title.className = "wrap-ok";
        return [courseCell([list[0]]), title, cell(String(list.length), list.length), t, enrolled(list)];
      });
    } else {
      head = ["Term", "Courses", "Sections", "Enrolled"];
      rows = grouped((s) => s.term).map((list) => {
        const courses = uniq(list, "course").sort((a, b) => a.course.localeCompare(b.course));
        return [cell(list[0].termName, list[0].term), courseCell(courses),
          cell(String(list.length), list.length), enrolled(list)];
      });
    }
    return {
      head,
      rows: rows.map((cells) => {
        const tr = document.createElement("tr");
        tr.append(...cells);
        return tr;
      }),
    };
  }

  // ---------- sorting ----------
  const key = (tr, i) => {
    const td = tr.cells[i];
    return td ? (td.dataset.sort ?? td.textContent.trim()) : "";
  };
  const compare = (a, b) => {
    const x = parseFloat(a), y = parseFloat(b);
    if (!Number.isNaN(x) && !Number.isNaN(y) && x !== y) return x - y;
    return String(a).localeCompare(String(b), undefined, { numeric: true });
  };

  function render() {
    const { head, rows } = build();
    if (head) {
      thead.replaceChildren();
      const tr = thead.insertRow();
      head.forEach((h) => {
        const th = document.createElement("th");
        th.textContent = h;
        tr.append(th);
      });
    } else {
      thead.innerHTML = original.head;
    }
    const n = thead.rows[0].cells.length;
    if (sortCol >= n) sortCol = -1;
    const sorted = sortCol < 0 ? rows
      : [...rows].sort((a, b) => sortDir * compare(key(a, sortCol), key(b, sortCol)));
    tbody.replaceChildren(...sorted);
    [...thead.rows[0].cells].forEach((th, i) => {
      const label = th.textContent;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "sort";
      button.textContent = label;
      th.replaceChildren(button);
      th.setAttribute("aria-sort", i !== sortCol ? "none" : sortDir > 0 ? "ascending" : "descending");
      button.addEventListener("click", () => {
        sortDir = i === sortCol ? -sortDir : 1;
        sortCol = i;
        render();
      });
    });
  }

  render();
})();
