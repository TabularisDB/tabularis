// Helpers prepended to every act.mjs snippet. tauri-wd injects synthetic
// events, so these work at the DOM level: React inputs get their value through
// the native setter, menus open on dispatched mouse events.

/** Visible inputs and buttons, one per line, for finding selectors. */
globalThis.dump = () =>
  browser.execute(() =>
    [...document.querySelectorAll("input, select, textarea, button, [role=menuitem], [role=switch]")]
      .filter((e) => e.offsetParent)
      .map((e) => `${e.tagName.toLowerCase()}[${e.type || e.getAttribute("role") || ""}] ${(e.getAttribute("aria-label") || e.placeholder || e.textContent || "").trim().slice(0, 50)}`)
      .filter((s) => !/^button\[submit\]\s*$/.test(s))
      .join("\n"),
  );

/** Sets a controlled React input. setValue() does not reach React here. */
globalThis.fill = (sel, v) =>
  browser.execute((sel, v) => {
    const el = document.querySelector(sel);
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement : HTMLInputElement;
    Object.getOwnPropertyDescriptor(proto.prototype, "value").set.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return el.value;
  }, sel, v);

/** Clicks the first visible button-like element by aria-label, exact text, then text prefix. */
globalThis.clickText = (t) =>
  browser.execute((t) => {
    const els = [...document.querySelectorAll("button, [role=menuitem], [role=button], a, [role=tab], [role=option]")]
      .filter((e) => e.getClientRects().length);
    const el =
      els.find((e) => (e.getAttribute("aria-label") || "").trim() === t) ||
      els.find((e) => e.textContent.trim() === t) ||
      els.find((e) => e.textContent.trim().startsWith(t));
    if (!el) return "NOTFOUND " + t;
    el.click();
    return "clicked " + t;
  }, t);

/** Visible button/menu labels, with [disabled] marks. */
globalThis.visibleTexts = () =>
  browser.execute(() =>
    [...document.querySelectorAll("button, [role=menuitem]")]
      .filter((e) => e.getClientRects().length)
      .map((e) => e.textContent.trim() + (e.disabled || e.getAttribute("aria-disabled") === "true" ? " [disabled]" : ""))
      .filter(Boolean),
  );

/** Hovers an element by exact text (opens context-menu submenus). */
globalThis.hover = (t) =>
  browser.execute((t) => {
    const el = [...document.querySelectorAll("button, [role=menuitem], div")]
      .filter((e) => e.getClientRects().length && e.textContent.trim() === t)
      .pop();
    if (!el) return "NOTFOUND " + t;
    const r = el.getBoundingClientRect();
    for (const ty of ["pointerover", "pointerenter", "mouseover", "mouseenter", "pointermove", "mousemove"]) {
      const Ctor = ty.startsWith("pointer") ? PointerEvent : MouseEvent;
      el.dispatchEvent(new Ctor(ty, { bubbles: !ty.endsWith("enter"), clientX: r.x + 20, clientY: r.y + 5 }));
    }
    return "hovered";
  }, t);

/** Dispatches a double-click on the leaf element with that exact text (e.g. a table in the explorer). */
globalThis.dbl = (t) =>
  browser.execute((t) => {
    const el = [...document.querySelectorAll("span, div")]
      .filter((e) => e.children.length === 0 && e.textContent.trim() === t)
      .pop();
    if (!el) return "NOTFOUND";
    el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    return "ok";
  }, t);

/** Text toasts currently shown. */
globalThis.toasts = () =>
  browser.execute(() =>
    [...document.querySelectorAll("[role=status], [role=alert], li[data-sonner-toast], [class*=toast]")]
      .map((e) => e.textContent.trim())
      .filter(Boolean)
      .slice(-4),
  );

// --- Navigation -------------------------------------------------------------

globalThis.goConnections = () =>
  browser.execute(() => {
    const a = [...document.querySelectorAll("a, button")].find(
      (e) => (e.getAttribute("aria-label") || e.title || e.textContent).trim() === "Connections",
    );
    a?.click();
    return !!a;
  });

/** Clicks the Connect button of a card on the Connections page. */
globalThis.connectCard = (id) =>
  browser.execute((id) => {
    const c = document.querySelector(`[data-connection-id="${id}"]`);
    if (!c) return "nocard";
    const b = [...c.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") || b.title) === "Connect");
    if (!b) return "nobtn";
    b.click();
    return "ok";
  }, id);

// --- Data grid --------------------------------------------------------------

/**
 * Clicks a grid cell. r = 0-based row, c = 0-based column counting the "#"
 * gutter. opts.shift extends the range, opts.type = "contextmenu" right-clicks.
 */
globalThis.cell = (r, c, opts = {}) =>
  browser.execute((r, c, opts) => {
    const td = document.querySelectorAll("table tbody tr")[r].querySelectorAll("td")[c];
    const rc = td.getBoundingClientRect();
    const ev = {
      bubbles: true,
      cancelable: true,
      clientX: rc.x + 10,
      clientY: rc.y + 8,
      button: opts.type === "contextmenu" ? 2 : 0,
      shiftKey: !!opts.shift,
    };
    const types = opts.type === "contextmenu" ? ["mousedown", "contextmenu"] : ["mousedown", "mouseup", "click"];
    for (const ty of types) td.dispatchEvent(new MouseEvent(ty, ev));
    return td.textContent;
  }, r, c, opts);

globalThis.gridText = () =>
  browser.execute(() =>
    [...document.querySelectorAll("table tbody tr")].map((tr) =>
      [...tr.querySelectorAll("td")].map((td) => JSON.stringify(td.textContent)).join(" | "),
    ),
  );

// --- Mouse drags (Connections page, sidebar rail) ---------------------------
// Those drags listen on document mousemove/mouseup and use elementFromPoint,
// so dispatched events at real coordinates drive them.

globalThis.dragStart = (sel) =>
  browser.execute((s) => {
    const el = document.querySelector(s);
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }));
  }, sel);

/** Moves to a point inside the target: fx/fy are fractions of its width/height. */
globalThis.dragMove = (sel, fx, fy) =>
  browser.execute((s, fx, fy) => {
    const r = document.querySelector(s).getBoundingClientRect();
    const x = r.x + r.width * fx;
    const y = r.y + r.height * fy;
    // Several moves: the first one only crosses the drag threshold.
    for (let i = 0; i < 3; i++) document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: x + i, clientY: y }));
  }, sel, fx, fy);

globalThis.dragEnd = (sel, fx, fy) =>
  browser.execute((s, fx, fy) => {
    const r = document.querySelector(s).getBoundingClientRect();
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: r.x + r.width * fx + 2, clientY: r.y + r.height * fy }));
  }, sel, fx, fy);
