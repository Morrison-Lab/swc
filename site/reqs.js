/* Course pages: fold controls for the requisite trees, and the requisite graph.
 *
 * The trees are nested <details> written by scraper/pages.py and fold without
 * this script; it adds "Unfold all" and "Fold all" and opens the folds around
 * an entry that a "see under" link points to.
 *
 * The graph draws data/graph.json (also from pages.py) with Cytoscape.js and
 * its dagre layout, loaded from jsDelivr only when the graph is first opened.
 * Course titles reach the page as canvas labels or textContent, never as HTML.
 */
(() => {
  "use strict";

  const LIBS = [
    ["https://cdn.jsdelivr.net/npm/cytoscape@3.34.3/dist/cytoscape.min.js",
      "sha384-qPKQxl9uMXOw7vSTUDAnpUilhLuulovw6P5Z4db4bqxW5VhumS7przEmHX0iM0Oc"],
    ["https://cdn.jsdelivr.net/npm/cytoscape-dagre@4.0.1/dist/cytoscape-dagre.min.js",
      "sha384-CIu9EFddQ0GplFvevqHZ1sIPo1IRXFvxHd0A6jaJ3m052fy+mDfer/ItnvIS5uY3"],
  ];
  const PRE_DEPTH = 6;     // as the prerequisite tree
  const PRE_START = 80;    // courses shown at first, at most, above the course...
  const POST_START = 40;   // ...and below it; a level that would pass this stays folded
  const MIN_ZOOM = 0.75;   // the smallest zoom the first view uses, to keep labels legible

  // ---------- trees ----------
  document.querySelectorAll(".req-tree").forEach((tree) => {
    const list = tree.querySelector(":scope > ul");
    if (!list || !list.querySelector("details")) return;
    const bar = document.createElement("p");
    bar.className = "tree-tools";
    for (const [text, open] of [["Unfold all", true], ["Fold all", false]]) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = text;
      b.addEventListener("click", () => list.querySelectorAll("details").forEach((d) => { d.open = open; }));
      bar.append(b);
    }
    list.before(bar);
  });

  // The id the URL's hash names; none for a malformed one.
  const hashId = () => {
    try {
      return decodeURIComponent(location.hash.slice(1));
    } catch {
      return "";
    }
  };

  // Opens every fold around the entry `id` and scrolls to it.
  function reveal(id) {
    const el = id && document.getElementById(id);
    if (!el) return;
    for (let d = el.parentElement?.closest("details"); d; d = d.parentElement?.closest("details")) d.open = true;
    el.scrollIntoView({ block: "center" });
    el.classList.remove("flash");
    void el.offsetWidth;  // restart the highlight
    el.classList.add("flash");
  }
  document.addEventListener("click", (ev) => {
    const a = ev.target.closest(".req-tree a[href^='#']");
    if (!a) return;
    ev.preventDefault();
    history.pushState(null, "", a.getAttribute("href"));
    reveal(hashId());
  });
  window.addEventListener("hashchange", () => reveal(hashId()));
  if (location.hash) reveal(hashId());

  // ---------- graph ----------
  const loadScript = ([src, integrity]) => new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.integrity = integrity;
    s.crossOrigin = "anonymous";
    s.onload = resolve;
    s.onerror = () => {
      s.remove();
      reject(new Error("the graph library did not load from cdn.jsdelivr.net"));
    };
    document.head.append(s);
  });
  let libs, graphData;
  // In order: the dagre layout registers itself with window.cytoscape.
  const loadLibs = () => (libs ||= LIBS.reduce((p, lib) => p.then(() => loadScript(lib)), Promise.resolve()));
  const loadGraph = () => (graphData ||= fetch("../data/graph.json").then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }));

  document.querySelectorAll(".req-graph").forEach((box) => {
    box.addEventListener("toggle", () => {
      if (!box.open || box.dataset.ready) return;
      box.dataset.ready = "1";
      const info = box.querySelector(".graph-info");
      info.textContent = "Loading the graph...";
      Promise.all([loadLibs(), loadGraph()]).then(([, g]) => draw(box, g)).catch((e) => {
        libs = graphData = undefined;
        box.dataset.ready = "";
        info.textContent = `Could not draw the graph (${e.message}).`;
      });
    });
  });

  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

  function style() {
    const accent = css("--accent"), muted = css("--muted");
    return [
      { selector: "node", style: {
        shape: "round-rectangle", width: 140, height: 46,
        "background-color": css("--panel"), "border-width": 1, "border-color": css("--line"),
        label: "data(label)", "text-wrap": "wrap", "text-max-width": 132,
        "text-valign": "center", "text-halign": "center",
        "font-size": 12, "font-family": getComputedStyle(document.body).fontFamily, color: css("--fg"),
      } },
      { selector: "node.more", style: { "border-style": "dashed", "border-width": 2, "border-color": accent } },
      { selector: "node.root", style: {
        "background-color": accent, "border-color": accent, color: css("--bg"), "font-weight": "bold",
      } },
      { selector: "node:selected", style: { "border-width": 3, "border-style": "solid", "border-color": accent } },
      { selector: "edge", style: {
        width: 1.2, "curve-style": "bezier", "target-arrow-shape": "triangle", "arrow-scale": 0.9,
        "line-color": muted, "target-arrow-color": muted, opacity: 0.75,
      } },
      { selector: "edge.hl", style: {
        width: 2.5, "line-color": accent, "target-arrow-color": accent, opacity: 1, "z-index": 9,
      } },
    ];
  }

  function draw(box, g) {
    const root = box.dataset.course;
    const pre = (k) => g[k]?.[2] || [];
    const post = (k) => g[k]?.[3] || [];
    const info = box.querySelector(".graph-info");
    const container = box.querySelector(".graph-box");
    // The courses whose prerequisites (up) or followers (down) are unfolded.
    let up, down;

    // Unfolds level by level from the course while the courses shown stay
    // within `limit`; the course itself is always unfolded.
    function grow(set, next, depth, limit) {
      const seen = new Set([root]);
      let level = [root];
      for (let d = 0; d < depth && level.length; d++) {
        const nextLevel = [...new Set(level.flatMap(next))].filter((k) => !seen.has(k));
        if (d && seen.size + nextLevel.length > limit) break;
        level.forEach((k) => set.add(k));
        nextLevel.forEach((k) => seen.add(k));
        level = nextLevel;
      }
    }
    function start() {
      up = new Set();
      down = new Set();
      grow(up, pre, PRE_DEPTH, PRE_START);
      grow(down, post, Infinity, POST_START);
    }

    // The courses reachable from the root through unfolded courses, with the
    // side they were reached on, and an edge from each unfolded course to each
    // of its shown neighbours: several edges into one course are branches
    // converging on it.
    function shown() {
      const side = new Map([[root, "root"]]);
      const edges = new Map();
      const walk = (open, next, name, edge) => {
        const queue = [root];
        for (const k of queue) {
          if (!open.has(k)) continue;
          for (const c of next(k)) {
            if (!g[c]) continue;
            const [s, t] = edge(k, c);
            edges.set(`${s}>${t}`, { source: s, target: t });
            if (!side.has(c)) {
              side.set(c, name);
              queue.push(c);
            }
          }
        }
      };
      walk(up, pre, "pre", (k, c) => [c, k]);
      walk(down, post, "post", (k, c) => [k, c]);
      return { side, edges };
    }

    const foldOf = (k, side) => (side === "pre" ? [up, pre(k)] : side === "post" ? [down, post(k)] : [null, []]);

    function elements() {
      const { side, edges } = shown();
      const nodes = [...side].map(([k, s]) => {
        const [open, next] = foldOf(k, s);
        const hidden = open && !open.has(k) ? next.filter((c) => g[c] && !side.has(c)).length : 0;
        const more = open && !open.has(k) && next.some((c) => g[c]);
        const title = clip(g[k]?.[0] || "", 34);
        return {
          group: "nodes",
          data: { id: k, side: s, label: `${k}${hidden ? `  (+${hidden})` : ""}\n${title}` },
          classes: [s === "root" ? "root" : "", more ? "more" : ""].join(" ").trim(),
        };
      });
      return nodes.concat([...edges.values()].map((d) => ({ group: "edges", data: d })));
    }

    const layout = { name: "dagre", rankDir: "TB", nodeSep: 18, rankSep: 56, edgeSep: 8, animate: false, fit: false };

    const cy = cytoscape({
      container,
      style: style(),
      minZoom: 0.15,
      maxZoom: 2.5,
      wheelSensitivity: 0.3,
      userZoomingEnabled: false,  // until the graph is clicked, so the wheel scrolls the page
      boxSelectionEnabled: false,
      autoungrabify: true,
    });
    container.addEventListener("pointerdown", () => cy.userZoomingEnabled(true));
    container.addEventListener("pointerleave", () => cy.userZoomingEnabled(false));

    // Redraws the graph; keeps `anchor` where it was on screen, or fits the
    // whole graph when there is none (zoomed in on the course if that would
    // leave the labels too small).
    function render(anchor) {
      const before = anchor && cy.getElementById(anchor).renderedPosition();
      cy.elements().remove();
      cy.add(elements());
      cy.layout(layout).run();
      if (before) {
        const node = cy.getElementById(anchor);
        node.select();
        const after = node.renderedPosition();
        cy.panBy({ x: before.x - after.x, y: before.y - after.y });
        describe(node);
      } else {
        cy.fit(undefined, 24);
        if (cy.zoom() < MIN_ZOOM) {
          cy.zoom(MIN_ZOOM);
          cy.center(cy.getElementById(root));
        }
        describe(null);
      }
    }

    function describe(node) {
      info.replaceChildren();
      const count = cy.nodes().length;
      if (!node) {
        info.textContent = `${count} course${count === 1 ? "" : "s"} shown. Click one to fold or unfold it.`;
        return;
      }
      const k = node.id();
      const [open, next] = foldOf(k, node.data("side"));
      const n = next.length;
      const what = node.data("side") === "pre"
        ? `${n} prerequisite${n === 1 ? " is" : "s are"}`
        : `${n} course${n === 1 ? " that requires it is" : "s that require it are"}`;
      let state = "";
      if (open && n) {
        state = open.has(k) ? ` ${what} shown; click again to fold.` : ` ${what} folded; click again to show.`;
      }
      info.append(`${k}: ${g[k]?.[0] || ""}.${state} `);
      const slug = g[k]?.[1];
      if (slug && k !== root) {
        const a = document.createElement("a");
        a.href = `${encodeURIComponent(slug)}.html`;
        a.textContent = `Open ${k}`;
        info.append(a);
      }
    }

    cy.on("tap", "node", (ev) => {
      const node = ev.target;
      cy.edges().removeClass("hl");
      node.connectedEdges().addClass("hl");
      const k = node.id();
      const [open, next] = foldOf(k, node.data("side"));
      if (!open || !next.length) {
        describe(node);
        return;
      }
      open.has(k) ? open.delete(k) : open.add(k);
      render(k);
      cy.getElementById(k).connectedEdges().addClass("hl");
    });
    cy.on("dbltap", "node", (ev) => {
      const slug = g[ev.target.id()]?.[1];
      if (slug && ev.target.id() !== root) location.href = `${encodeURIComponent(slug)}.html`;
    });
    cy.on("tap", (ev) => {
      if (ev.target === cy) {
        cy.edges().removeClass("hl");
        describe(null);
      }
    });

    const tools = box.querySelector(".graph-tools");
    tools.hidden = false;
    tools.addEventListener("click", (ev) => {
      const act = ev.target.closest("button")?.dataset.act;
      const mid = { x: container.clientWidth / 2, y: container.clientHeight / 2 };
      if (act === "fit") cy.fit(undefined, 24);
      else if (act === "in") cy.zoom({ level: cy.zoom() * 1.25, renderedPosition: mid });
      else if (act === "out") cy.zoom({ level: cy.zoom() / 1.25, renderedPosition: mid });
      else if (act === "reset") {
        start();
        render();
      }
    });
    // theme.js switches themes with a data-theme attribute on <html>.
    new MutationObserver(() => cy.style(style()))
      .observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    start();
    render();
  }
})();
