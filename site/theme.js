/* Theme dropdown: Light, Off-white, Parchment, Dark.
 *
 * Ported from Morrison-Lab/qwt's theme-picker.html (the dropdown on the lab's
 * Quarto sites) so this site offers the same four choices with the same
 * colours. The choice is saved under the same "mln-theme" key, which is shared
 * by every lab site on morrison-lab.github.io, so picking one here picks it
 * there too. Off-white is the default for a first visit, or Dark when the
 * system asks for it. This site has no Quarto or Bootstrap, so the choice is a
 * data-theme attribute on <html> that style.css keys its colours on, and the
 * menu is plain HTML. Loaded in <head> so the theme is set before first paint.
 */
(function () {
  "use strict";
  var KEY = "mln-theme";
  var OPTIONS = [["light", "Light"], ["offwhite", "Off-white"], ["parchment", "Parchment"], ["dark", "Dark"]];
  // The palette icon from Bootstrap Icons (MIT), as on the Quarto sites.
  var ICON = '<svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">' +
    '<path d="M8 5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3m4 3a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3M5.5 7a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0m.5 6a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3"/>' +
    '<path d="M16 8c0 3.15-1.866 2.585-3.567 2.07C11.42 9.763 10.465 9.473 10 10c-.603.683-.475 1.819-.351 2.92C9.826 14.495 9.996 16 8 16a8 8 0 1 1 8-8m-8 7c.611 0 .654-.171.655-.176.078-.146.124-.464.07-1.119-.014-.168-.037-.37-.061-.591-.052-.464-.112-1.005-.118-1.462-.01-.707.083-1.61.704-2.314.369-.417.845-.578 1.272-.618.404-.038.812.026 1.16.104.343.077.702.186 1.025.284l.028.008c.346.105.658.199.953.266.653.148.904.083.991.024C14.717 9.38 15 9.161 15 8a7 7 0 1 0-7 7"/></svg>';

  function valid(choice) {
    return OPTIONS.some(function (o) { return o[0] === choice; });
  }
  function stored() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function fallback() {
    var dark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    return dark ? "dark" : "offwhite";
  }
  function mark(choice) {
    document.querySelectorAll(".theme-picker [data-theme-choice]").forEach(function (b) {
      b.setAttribute("aria-checked", b.getAttribute("data-theme-choice") === choice ? "true" : "false");
    });
  }
  function apply(choice, remember) {
    document.documentElement.setAttribute("data-theme", choice);
    if (remember) { try { localStorage.setItem(KEY, choice); } catch (e) {} }
    mark(choice);
  }

  // Set the theme before first paint to avoid a flash.
  var first = stored();
  apply(valid(first) ? first : fallback(), false);

  document.addEventListener("DOMContentLoaded", function () {
    var slot = document.getElementById("theme-slot");
    if (!slot) return;
    var wrap = document.createElement("div");
    wrap.className = "theme-picker";
    wrap.innerHTML =
      '<button type="button" class="theme-button" aria-haspopup="menu" aria-expanded="false" aria-label="Colour theme" title="Colour theme">' + ICON + "</button>" +
      '<ul class="theme-menu" role="menu" hidden>' +
      OPTIONS.map(function (o) {
        return '<li role="none"><button type="button" role="menuitemradio" aria-checked="false" data-theme-choice="' + o[0] + '">' + o[1] + "</button></li>";
      }).join("") + "</ul>";
    slot.appendChild(wrap);
    var button = wrap.querySelector(".theme-button");
    var menu = wrap.querySelector(".theme-menu");
    var items = Array.prototype.slice.call(menu.querySelectorAll("[data-theme-choice]"));

    function open(show) {
      menu.hidden = !show;
      button.setAttribute("aria-expanded", show ? "true" : "false");
      if (show) {
        var on = menu.querySelector('[aria-checked="true"]') || items[0];
        on.focus();
      }
    }
    button.addEventListener("click", function () { open(menu.hidden); });
    menu.addEventListener("click", function (e) {
      var b = e.target.closest("[data-theme-choice]");
      if (!b) return;
      apply(b.getAttribute("data-theme-choice"), true);
      open(false);
      button.focus();
    });
    wrap.addEventListener("keydown", function (e) {
      if (menu.hidden) return;
      var i = items.indexOf(document.activeElement);
      var next = null;
      if (e.key === "ArrowDown") next = i < 0 ? 0 : (i + 1) % items.length;
      else if (e.key === "ArrowUp") next = i < 0 ? items.length - 1 : (i - 1 + items.length) % items.length;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = items.length - 1;
      else if (e.key === "Escape") {
        e.preventDefault();
        open(false);
        button.focus();
        return;
      }
      if (next !== null) {
        e.preventDefault();
        items[next].focus();
      }
    });
    // Close when focus or a click lands outside the picker.
    wrap.addEventListener("focusout", function (e) {
      if (!menu.hidden && e.relatedTarget && !wrap.contains(e.relatedTarget)) open(false);
    });
    document.addEventListener("click", function (e) {
      if (!menu.hidden && !wrap.contains(e.target)) open(false);
    });
    mark(document.documentElement.getAttribute("data-theme"));
  });
})();
