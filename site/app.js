/* WWU Course Explorer: client-side search over data/courses.json. */
(() => {
  "use strict";

  const PAGE = 50;
  const BROWSE_URL =
    "https://registration.banner.wwu.edu/StudentRegistrationSsb/ssb/term/termSelection?mode=search";
  const CATALOG_SEARCH =
    "https://catalog.wwu.edu/search_advanced.php?cur_cat_oid=23&search_database=Search" +
    "&search_db=Search&cpage=1&ecpage=1&ppage=1&spage=1&tpage=1&location=3&filter%5Bkeyword%5D=";
  const DAY_ORDER = "MTWRFSU";

  const $ = (id) => document.getElementById(id);
  const els = {
    q: $("q"), subj: $("f-subj"), term: $("f-term"), level: $("f-level"),
    attr: $("f-attr"), method: $("f-method"), instr: $("f-instr"),
    results: $("results"), status: $("status"), more: $("more"),
    reset: $("reset"), instructors: $("instructors"), updated: $("updated"),
  };

  let data, byId, search, termName, shown = PAGE, current = [];
  const open = new Set();

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));

  const fmtTime = (t) => {
    if (!t) return "";
    let h = +t.slice(0, 2);
    const m = t.slice(2);
    const ap = h >= 12 ? "pm" : "am";
    h = h % 12 || 12;
    return `${h}:${m}${ap}`;
  };

  const meetingText = (m) => {
    const [days, begin, end, bldg, room] = m;
    const when = days || begin ? `${days || ""} ${fmtTime(begin)}${end ? "-" + fmtTime(end) : ""}`.trim() : "TBA";
    const where = [bldg, room].filter(Boolean).join(" ");
    return where ? `${when} · ${where}` : when;
  };

  // Static pages written by scraper/pages.py, by course id and instructor name.
  const coursePage = (id) => `course/${encodeURIComponent(data.pages.courses[id])}.html`;
  const instrLink = (n, text = n) => {
    const slug = data.pages.instructors[n];
    return slug ? `<a href="instructor/${encodeURIComponent(slug)}.html">${esc(text)}</a>` : esc(text);
  };

  const shortName = (n) => {
    // "Last, First Middle" -> "First Last"
    const [last, rest] = n.split(",").map((s) => s.trim());
    return rest ? `${rest.split(/\s+/)[0]} ${last}` : n;
  };

  // The term in progress (or next to start) by today's date, as a Banner code:
  // Winter (10) Jan-Mar, Spring (20) Apr-Jun, Summer (30) Jul-Aug, Fall (40)
  // Sep-Dec. Terms before it are past.
  const CURRENT_TERM = (() => {
    const d = new Date();
    const m = d.getMonth();
    return `${d.getFullYear()}${m < 3 ? 10 : m < 6 ? 20 : m < 8 ? 30 : 40}`;
  })();
  const PAST_CHIPS = 3;

  function instructorsByTerm(c) {
    const out = new Map();
    for (const s of c.sections) {
      if (!out.has(s.term)) out.set(s.term, new Set());
      s.instr.forEach((i) => out.get(s.term).add(i));
    }
    return out;
  }

  // ---------- state <-> URL ----------
  function readHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    els.q.value = p.get("q") || "";
    els.subj.value = p.get("subj") || "";
    els.term.value = p.get("term") || "";
    els.level.value = p.get("level") || "";
    els.attr.value = p.get("attr") || "";
    els.method.value = p.get("method") || "";
    els.instr.value = p.get("instr") || "";
    open.clear();
    (p.get("open") || "").split("|").filter(Boolean).forEach((id) => open.add(id));
  }

  function writeHash() {
    const p = new URLSearchParams();
    const set = (k, v) => v && p.set(k, v);
    set("q", els.q.value.trim());
    set("subj", els.subj.value);
    set("term", els.term.value);
    set("level", els.level.value);
    set("attr", els.attr.value);
    set("method", els.method.value);
    set("instr", els.instr.value.trim());
    set("open", [...open].join("|"));
    const h = p.toString();
    history.replaceState(null, "", h ? "#" + h : location.pathname + location.search);
  }

  // ---------- filtering ----------
  function matches(c) {
    if (els.subj.value && c.subj !== els.subj.value) return false;
    if (els.level.value && String(c.level) !== els.level.value) return false;
    const t = els.term.value;
    const special = t === "any" || t === "none" || t === "upcoming";
    if (t === "any" && !c.offered.length) return false;
    if (t === "none" && c.offered.length) return false;
    if (t === "upcoming" && !c.offered.some((o) => o >= CURRENT_TERM)) return false;
    if (t && !special && !c.offered.includes(t)) return false;
    const a = els.attr.value;
    const m = els.method.value;
    const who = els.instr.value.trim().toLowerCase();
    if (a || m || who) {
      // All section-level filters must hold for the same section, and in the
      // chosen term when one is picked.
      const ok = c.sections.some((s) =>
        (t === "upcoming" ? s.term >= CURRENT_TERM : !t || special || s.term === t) &&
        (!a || s.attrs.includes(a)) &&
        (!m || s.method === m) &&
        (!who || s.instr.some((i) => i.toLowerCase().includes(who))));
      if (!ok) return false;
    }
    return true;
  }

  function run() {
    const q = els.q.value.trim();
    let list;
    if (q) {
      const opts = { prefix: true, fuzzy: 0.15, boost: { code: 6, title: 3, instr: 2 } };
      let hits = search.search(q, { ...opts, combineWith: "AND" });
      if (!hits.length) hits = search.search(q, opts);
      list = hits.map((h) => byId.get(h.id));
    } else {
      list = data.courses;
    }
    current = list.filter(matches);
    shown = PAGE;
    writeHash();
    render();
  }

  // ---------- rendering ----------
  // Marks query words at word starts. Splits the raw text and escapes each
  // piece, so a match can never land inside an HTML entity.
  function highlight(text) {
    const raw = String(text ?? "");
    const words = els.q.value.trim().split(/\s+/).filter((w) => w.length > 2)
      .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    if (!words.length) return esc(raw);
    // A capture group for the preceding character instead of a lookbehind,
    // which older Safari lacks. split() yields [text, prefix, word, ...].
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${words.join("|")})`, "giu");
    return raw.split(re).map((part, i) => (i % 3 === 2 ? `<mark>${esc(part)}</mark>` : esc(part))).join("");
  }

  // One chip per term the course runs, newest first: every current and
  // upcoming term, then the most recent PAST_CHIPS past terms (plus the term
  // picked in the filter, so a match on an old term shows why) and a count of
  // earlier ones. An open course's sections table lists every term.
  function chips(c) {
    const by = instructorsByTerm(c);
    if (!by.size) return `<li class="chip off">Not offered in listed terms</li>`;
    const chip = (t, cls) => {
      const names = [...by.get(t.code)];
      const who = names.slice(0, 3).map((n) => instrLink(n, shortName(n)));
      if (names.length > 3) who.push(`+${names.length - 3}`);
      return `<li class="${cls}">${esc(t.name)}${who.length ? ` <span class="who">· ${who.join(", ")}</span>` : ""}</li>`;
    };
    const ran = [...data.terms].reverse().filter((t) => by.has(t.code));
    const ahead = ran.filter((t) => t.code >= CURRENT_TERM);
    const past = ran.filter((t) => t.code < CURRENT_TERM);
    const keep = past.filter((t, i) => i < PAST_CHIPS || t.code === els.term.value);
    const out = ahead.map((t) => chip(t, "chip")).concat(keep.map((t) => chip(t, "chip past")));
    if (past.length > keep.length) {
      const n = past.length - keep.length;
      out.push(`<li class="chip off">+${n} earlier term${n === 1 ? "" : "s"}</li>`);
    }
    return out.join("");
  }

  // Current and upcoming terms in one table, newest first; past terms in a
  // second table under a collapsed "Past terms" heading.
  function sectionsTable(c) {
    if (!c.sections.length) return "<p>No sections in the listed terms.</p>";
    const table = (terms) => {
      const rows = [];
      for (const t of terms) {
        const secs = c.sections.filter((s) => s.term === t.code);
        if (!secs.length) continue;
        rows.push(`<tr><th colspan="7">${esc(t.name)}</th></tr>`);
        for (const s of secs) {
          const full = s.max && s.enr >= s.max;
          rows.push(`<tr>
            <td>${esc(s.seq)}${s.title ? `<br><small>${esc(s.title)}</small>` : ""}</td>
            <td>${esc(s.crn)}</td>
            <td>${esc(s.type || "")}</td>
            <td class="wrap-ok">${s.mtg.length ? s.mtg.map((m) => esc(meetingText(m))).join("<br>") : "TBA"}</td>
            <td class="wrap-ok">${s.instr.length ? s.instr.map(instrLink).join("<br>") : "Staff"}</td>
            <td class="${full ? "full" : "open"}">${esc(s.enr ?? "")}/${esc(s.max ?? "")}</td>
            <td>${esc(data.methods[s.method] || s.method || "")}</td>
          </tr>`);
        }
      }
      return `<div class="table-scroll"><table>
        <thead><tr><th>Sec</th><th>CRN</th><th>Type</th><th>Meets</th><th>Instructor</th><th>Enrolled</th><th>Delivery</th></tr></thead>
        <tbody>${rows.join("")}</tbody></table></div>`;
    };
    const ran = new Set(c.sections.map((s) => s.term));
    const terms = [...data.terms].reverse().filter((t) => ran.has(t.code));
    const ahead = terms.filter((t) => t.code >= CURRENT_TERM);
    const past = terms.filter((t) => t.code < CURRENT_TERM);
    let out = ahead.length ? table(ahead) : "<p>Not scheduled this term or later.</p>";
    if (past.length) {
      const picked = past.some((t) => t.code === els.term.value);
      out += `<details class="past-terms"${picked ? " open" : ""}><summary>Past terms (${past.length})</summary>${table(past)}</details>`;
    }
    return out;
  }

  function links(c) {
    const out = [
      `<a href="${coursePage(c.id)}">Course page: every offering</a>`,
      `<a href="${CATALOG_SEARCH}${encodeURIComponent(c.id)}" target="_blank" rel="noopener">Catalog entry</a>`,
      `<a href="${BROWSE_URL}" target="_blank" rel="noopener">Browse Classes</a>`,
    ];
    for (const s of c.syllabi) {
      const bits = [s.label || "Syllabus", termName.get(s.term) || s.term, s.instructor].filter(Boolean);
      out.push(`<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(bits.join(" · "))}</a>`);
    }
    return out.join("");
  }

  function courseHTML(c) {
    const isOpen = open.has(c.id);
    const attrs = c.attrs.filter((a) => /^(GUR|WP|CF|SL|ZTC|LTC)/.test(data.attributes[a] || a) || /^(WP\d|ZTC|LTC|CF|SL)$/.test(a))
      .map((a) => `<span class="attr" title="${esc(data.attributes[a] || a)}">${esc(a)}</span>`).join(" ");
    const meta = [c.subjDesc || c.subj, c.cred ? `${c.cred} credit${c.cred === "1" ? "" : "s"}` : "", c.dept && c.dept !== c.subjDesc ? c.dept : ""]
      .filter(Boolean).map(esc).join(" · ");
    return `<li class="course" data-id="${esc(c.id)}">
      <h2><button type="button" aria-expanded="${isOpen}">
        <span class="code">${highlight(c.id)}</span>: ${highlight(c.title || "(untitled)")}
      </button></h2>
      <p class="meta">${meta} ${attrs} <a class="page-link" href="${coursePage(c.id)}">Course page</a></p>
      ${c.desc ? `<p class="desc${isOpen ? "" : " short"}">${highlight(c.desc)}</p>` : ""}
      <ul class="chips">${chips(c)}</ul>
      ${isOpen ? `<div class="detail">
        <h3>Sections</h3>${sectionsTable(c)}
        <div class="links">${links(c)}</div>
      </div>` : ""}
    </li>`;
  }

  function render() {
    const n = current.length;
    els.status.textContent = n === 1 ? "1 course" : `${n.toLocaleString()} courses`;
    els.results.innerHTML = current.slice(0, shown).map(courseHTML).join("");
    els.more.hidden = n <= shown;
  }

  function rerenderOne(id) {
    const li = els.results.querySelector(`li[data-id="${CSS.escape(id)}"]`);
    if (!li) return;
    li.outerHTML = courseHTML(byId.get(id));
    // outerHTML replaced the focused button; give focus to its replacement.
    els.results.querySelector(`li[data-id="${CSS.escape(id)}"] h2 button`)?.focus();
  }

  // ---------- setup ----------
  function fillSelect(sel, pairs) {
    for (const [value, label] of pairs) {
      const o = document.createElement("option");
      o.value = value;
      o.textContent = label;
      sel.appendChild(o);
    }
  }

  async function init() {
    if (typeof MiniSearch === "undefined") {
      throw new Error("the search library did not load from cdn.jsdelivr.net");
    }
    const res = await fetch("data/courses.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
    byId = new Map(data.courses.map((c) => [c.id, c]));
    termName = new Map(data.terms.map((t) => [t.code, t.name]));

    const subjects = new Map();
    // Keep the first non-empty subject name; courses known only from
    // sections have none.
    data.courses.forEach((c) => {
      if (!subjects.get(c.subj)) subjects.set(c.subj, c.subjDesc || "");
    });
    fillSelect(els.subj, [...subjects].map(([k, v]) => [k, v ? `${v} (${k})` : k])
      .sort((a, b) => a[1].localeCompare(b[1])));
    const levels = [...new Set(data.courses.map((c) => c.level).filter((l) => l !== null))].sort((a, b) => a - b);
    fillSelect(els.level, levels.map((l) =>
      [String(l), l === 0 ? "Below 100" : l >= 500 ? `${l} (graduate)` : String(l)]));
    fillSelect(els.term, [...data.terms].reverse().map((t) => [t.code, t.name]));
    const usedAttrs = new Set(data.courses.flatMap((c) => c.attrs));
    fillSelect(els.attr, Object.entries(data.attributes).filter(([k]) => usedAttrs.has(k))
      .sort((a, b) => a[1].localeCompare(b[1])));
    fillSelect(els.method, Object.entries(data.methods));
    const names = new Set();
    data.courses.forEach((c) => c.sections.forEach((s) => s.instr.forEach((i) => names.add(i))));
    els.instructors.innerHTML = [...names].sort().map((n) => `<option value="${esc(n)}">`).join("");
    if (data.terms.length) {
      els.updated.textContent = `Terms loaded: ${data.terms[0].name} to ${data.terms[data.terms.length - 1].name}.`;
    }

    search = new MiniSearch({
      idField: "id",
      fields: ["code", "title", "desc", "instr", "subjDesc", "dept"],
      extractField: (c, f) => {
        if (f === "code") return `${c.id} ${c.subj}${c.num}`;
        if (f === "instr") return [...new Set(c.sections.flatMap((s) => s.instr))].join(" ");
        return c[f];
      },
    });
    search.addAll(data.courses);

    readHash();
    run();

    let timer;
    els.q.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(run, 150); });
    els.instr.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(run, 150); });
    [els.subj, els.term, els.level, els.attr, els.method].forEach((e) => e.addEventListener("change", run));
    els.reset.addEventListener("click", () => {
      els.q.value = els.instr.value = "";
      [els.subj, els.term, els.level, els.attr, els.method].forEach((e) => (e.value = ""));
      open.clear();
      run();
    });
    els.more.addEventListener("click", () => { shown += PAGE; render(); });
    els.results.addEventListener("click", (ev) => {
      const btn = ev.target.closest("h2 button");
      if (!btn) return;
      const id = btn.closest("li").dataset.id;
      open.has(id) ? open.delete(id) : open.add(id);
      writeHash();
      rerenderOne(id);
    });
    window.addEventListener("hashchange", () => { readHash(); run(); });
  }

  init().catch((e) => {
    els.status.textContent = `Could not load course data (${e.message}).`;
  });
})();
