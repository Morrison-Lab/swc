/* Checkbox dropdown for the explorer's filters.
 *
 * new MultiSelect(root, {labelId, all, noun, find}) turns an empty element
 * into a button that opens a list of checkboxes. `all` is the button text with
 * nothing picked ("All subjects"), `noun` names several picks ("3 subjects"),
 * `find` adds a box that narrows a long list, and `matchAll` adds a "Match
 * all" switch (read from .matchAll) for filters where requiring every pick
 * can make more sense than any one of them. The root element fires
 * "change" when the picks change. Escape, a click outside or tabbing away
 * closes the list; the arrow keys move between its checkboxes.
 */
(function () {
  "use strict";
  let uid = 0;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));

  class MultiSelect {
    constructor(root, { labelId, all, noun, find = false, matchAll = false }) {
      const id = `ms${++uid}`;
      this.root = root;
      this.all = all;
      this.noun = noun;
      this.labels = new Map();
      this.selected = new Set();
      root.classList.add("ms");
      root.innerHTML = `
        <button type="button" class="ms-btn" id="${id}-btn" aria-haspopup="true" aria-expanded="false"
          aria-controls="${id}-pop" aria-labelledby="${labelId} ${id}-btn"><span class="ms-text"></span></button>
        <div class="ms-pop" id="${id}-pop" role="group" aria-labelledby="${labelId}" hidden>
          <div class="ms-tools">
            ${find ? `<input type="search" class="ms-find" placeholder="Filter this list" aria-label="Filter this list" autocomplete="off">` : ""}
            <button type="button" class="link ms-clear">Clear</button>
          </div>
          ${matchAll ? `<label class="ms-mode"><input type="checkbox" class="ms-all"> Match all picks (otherwise any)</label>` : ""}
          <ul class="ms-list"></ul>
        </div>`;
      this.btn = root.querySelector(".ms-btn");
      this.text = root.querySelector(".ms-text");
      this.pop = root.querySelector(".ms-pop");
      this.list = root.querySelector(".ms-list");
      this.find = root.querySelector(".ms-find");
      this.allBox = root.querySelector(".ms-all");
      this.allBox?.addEventListener("change", () => {
        this.render();
        if (this.selected.size > 1) this.fire();
      });

      this.btn.addEventListener("click", () => (this.pop.hidden ? this.open() : this.close()));
      root.querySelector(".ms-clear").addEventListener("click", () => {
        if (!this.selected.size) return;
        this.values = [];
        this.fire();
      });
      this.list.addEventListener("change", (ev) => {
        const box = ev.target;
        box.checked ? this.selected.add(box.value) : this.selected.delete(box.value);
        this.render();
        this.fire();
      });
      if (this.find) {
        this.find.addEventListener("input", () => {
          const q = this.find.value.trim().toLowerCase();
          this.list.querySelectorAll("li").forEach((li) => {
            li.hidden = q !== "" && !li.textContent.toLowerCase().includes(q);
          });
        });
      }
      root.addEventListener("keydown", (ev) => this.key(ev));
      // Tabbing out of the list closes it; so does a click anywhere else.
      root.addEventListener("focusout", (ev) => {
        if (ev.relatedTarget && !root.contains(ev.relatedTarget)) this.close();
      });
      document.addEventListener("pointerdown", (ev) => {
        if (!this.pop.hidden && !root.contains(ev.target)) this.close();
      });
      this.render();
    }

    setOptions(pairs) {
      this.labels = new Map(pairs);
      this.list.innerHTML = pairs.map(([value, label], i) => {
        const id = `${this.btn.id}-${i}`;
        return `<li><input type="checkbox" id="${id}" value="${esc(value)}"${this.selected.has(value) ? " checked" : ""}>` +
          `<label for="${id}">${esc(label)}</label></li>`;
      }).join("");
      this.render();
    }

    get matchAll() {
      return !!this.allBox?.checked;
    }

    set matchAll(on) {
      if (this.allBox) this.allBox.checked = !!on;
      this.render();
    }

    // Picks in list order.
    get values() {
      return [...this.labels.keys()].filter((v) => this.selected.has(v));
    }

    set values(list) {
      this.selected = new Set(list.filter((v) => this.labels.has(v)));
      this.list.querySelectorAll("input").forEach((box) => { box.checked = this.selected.has(box.value); });
      this.render();
    }

    render() {
      const vals = this.values;
      this.text.textContent = !vals.length ? this.all
        : vals.length === 1 ? this.labels.get(vals[0])
        : `${vals.length} ${this.noun}${this.matchAll ? ", all" : ""}`;
      this.root.classList.toggle("ms-on", vals.length > 0);
    }

    fire() {
      this.root.dispatchEvent(new Event("change"));
    }

    open() {
      this.pop.hidden = false;
      this.btn.setAttribute("aria-expanded", "true");
      // Keep the list on screen when the button sits near the right edge.
      this.pop.style.left = "";
      const over = this.pop.getBoundingClientRect().right - (document.documentElement.clientWidth - 8);
      if (over > 0) this.pop.style.left = `${-over}px`;
      (this.find || this.list.querySelector("input"))?.focus();
    }

    close(focusButton = false) {
      if (this.pop.hidden) return;
      this.pop.hidden = true;
      this.btn.setAttribute("aria-expanded", "false");
      if (this.find && this.find.value) {
        this.find.value = "";
        this.list.querySelectorAll("li").forEach((li) => { li.hidden = false; });
      }
      if (focusButton) this.btn.focus();
    }

    key(ev) {
      if (ev.key === "Escape" && !this.pop.hidden) {
        ev.preventDefault();
        this.close(true);
        return;
      }
      if ((ev.key === "ArrowDown" || ev.key === "ArrowUp") && !this.pop.hidden) {
        const items = [this.find, this.allBox, ...this.list.querySelectorAll("li:not([hidden]) input")].filter(Boolean);
        if (!items.length) return;
        ev.preventDefault();
        const i = items.indexOf(document.activeElement);
        const next = ev.key === "ArrowDown" ? Math.min(i + 1, items.length - 1) : Math.max(i - 1, 0);
        items[next].focus();
      } else if (ev.key === "ArrowDown" && ev.target === this.btn) {
        ev.preventDefault();
        this.open();
      }
    }
  }

  window.MultiSelect = MultiSelect;
})();
