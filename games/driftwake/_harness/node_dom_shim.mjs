// node_dom_shim.mjs -- a SMALL DOM for headless UI probes (lane R).
//
// Not a browser: enough of the DOM for DOM/CSS panels written the way
// ui/boonPick.js and ui/shrineMenu.js are -- createElement, innerHTML (a real
// little HTML parser: elements, attributes, text, entities, <x/>),
// textContent, classList, dataset, style.setProperty, querySelector(All) and
// closest() over compound selectors (tag, #id, .class, [attr], [attr="v"],
// :not(compound)), and a three-phase event dispatch (capture -> target ->
// bubble, window at the top) with preventDefault / stopPropagation /
// stopImmediatePropagation. Pointer lock is modelled (document
// .pointerLockElement, exitPointerLock, element.requestPointerLock) and emits
// 'pointerlockchange' on document like a browser. requestAnimationFrame is a
// queue the probe drains with `pumpFrames()`.
//
//     import { installDom } from "./node_dom_shim.mjs";
//     const dom = installDom();   // sets globalThis.window/document/...
//
// No layout, no CSS cascade, no focus model (key events target body).

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decode(s) {
    return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, e) => {
        if (e[0] === "#") {
            const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
            return String.fromCodePoint(n);
        }
        return ENT[e.toLowerCase()] !== undefined ? ENT[e.toLowerCase()] : m;
    });
}
const VOID = new Set(["br", "img", "input", "hr", "meta", "link", "area", "base", "col", "source", "wbr"]);

class Ev {
    constructor(type, init) {
        this.type = type;
        Object.assign(this, init || {});
        this.bubbles = init && init.bubbles !== undefined ? init.bubbles : true;
        this.defaultPrevented = false;
        this._stop = false;
        this._stopNow = false;
        this.target = null;
        this.currentTarget = null;
        this.eventPhase = 0;
    }
    preventDefault() { this.defaultPrevented = true; }
    stopPropagation() { this._stop = true; }
    stopImmediatePropagation() { this._stop = true; this._stopNow = true; }
}

class Target {
    constructor() { this._ls = []; }
    addEventListener(type, fn, opt) {
        const capture = opt === true || !!(opt && opt.capture);
        if (this._ls.some((l) => l.type === type && l.fn === fn && l.capture === capture)) return;
        this._ls.push({ type, fn, capture });
    }
    removeEventListener(type, fn, opt) {
        const capture = opt === true || !!(opt && opt.capture);
        this._ls = this._ls.filter((l) => !(l.type === type && l.fn === fn && l.capture === capture));
    }
    _fire(ev, phase) {
        const list = this._ls.slice();
        for (const l of list) {
            if (l.type !== ev.type) continue;
            if (phase === 1 && !l.capture) continue;
            if (phase === 3 && l.capture) continue;
            if (this._ls.indexOf(l) < 0) continue;      // removed mid-dispatch
            ev.currentTarget = this;
            ev.eventPhase = phase;
            l.fn.call(this, ev);
            if (ev._stopNow) return;
        }
    }
    dispatchEvent(ev) {
        ev.target = this;
        const path = [];
        for (let n = this.parentNode; n; n = n.parentNode) path.push(n);
        if (this !== WIN) path.push(WIN);              // document -> window
        for (let i = path.length - 1; i >= 0; i--) {
            path[i]._fire(ev, 1);
            if (ev._stop) return !ev.defaultPrevented;
        }
        this._fire(ev, 1);                              // target: capture listeners
        if (!ev._stopNow) this._fire(ev, 3);            // ... then bubble listeners
        if (ev._stop || !ev.bubbles) return !ev.defaultPrevented;
        for (let i = 0; i < path.length; i++) {
            path[i]._fire(ev, 3);
            if (ev._stop) break;
        }
        return !ev.defaultPrevented;
    }
}

class TextNode {
    constructor(t) { this.nodeType = 3; this.data = t; this.parentNode = null; }
    get textContent() { return this.data; }
}

class ClassList {
    constructor(el) { this.el = el; }
    _get() { return (this.el.getAttribute("class") || "").split(/\s+/).filter(Boolean); }
    _set(a) { this.el.setAttribute("class", a.join(" ")); }
    contains(c) { return this._get().indexOf(c) >= 0; }
    add(...cs) { const a = this._get(); for (const c of cs) if (a.indexOf(c) < 0) a.push(c); this._set(a); }
    remove(...cs) { this._set(this._get().filter((x) => cs.indexOf(x) < 0)); }
    toggle(c, force) {
        const has = this.contains(c);
        const want = force === undefined ? !has : !!force;
        if (want && !has) this.add(c);
        if (!want && has) this.remove(c);
        return want;
    }
}

class Style {
    constructor() { this._p = {}; }
    setProperty(k, v) { this._p[k] = String(v); }
    getPropertyValue(k) { return this._p[k] || ""; }
    removeProperty(k) { delete this._p[k]; }
}

export class Element extends Target {
    constructor(tag) {
        super();
        this.nodeType = 1;
        this.tagName = tag.toUpperCase();
        this.localName = tag.toLowerCase();
        this.childNodes = [];
        this.parentNode = null;
        this._attrs = new Map();
        this.classList = new ClassList(this);
        this.style = new Style();
        const self = this;
        this.dataset = new Proxy({}, {
            get(_, k) {
                if (typeof k !== "string") return undefined;
                const v = self.getAttribute("data-" + k.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase()));
                return v === null ? undefined : v;
            },
            set(_, k, v) { self.setAttribute("data-" + String(k).replace(/[A-Z]/g, (m) => "-" + m.toLowerCase()), String(v)); return true; },
        });
        this.offsetWidth = 0;
        this.offsetHeight = 0;
    }
    get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
    get id() { return this.getAttribute("id") || ""; }
    set id(v) { this.setAttribute("id", v); }
    get className() { return this.getAttribute("class") || ""; }
    set className(v) { this.setAttribute("class", v); }
    getAttribute(k) { return this._attrs.has(k) ? this._attrs.get(k) : null; }
    setAttribute(k, v) { this._attrs.set(k, String(v)); }
    hasAttribute(k) { return this._attrs.has(k); }
    removeAttribute(k) { this._attrs.delete(k); }
    appendChild(n) {
        if (n.parentNode) n.parentNode.removeChild(n);
        n.parentNode = this;
        this.childNodes.push(n);
        return n;
    }
    removeChild(n) {
        const i = this.childNodes.indexOf(n);
        if (i >= 0) { this.childNodes.splice(i, 1); n.parentNode = null; }
        return n;
    }
    remove() { if (this.parentNode) this.parentNode.removeChild(this); }
    get textContent() { return this.childNodes.map((n) => n.textContent).join(""); }
    set textContent(t) {
        for (const n of this.childNodes) n.parentNode = null;
        this.childNodes = [];
        if (t !== "" && t != null) this.appendChild(new TextNode(String(t)));
    }
    get innerText() { return this.textContent; }
    set innerHTML(html) {
        for (const n of this.childNodes) n.parentNode = null;
        this.childNodes = [];
        parseInto(this, String(html));
    }
    get innerHTML() { return this.childNodes.map(serialize).join(""); }
    querySelectorAll(sel) {
        const out = [];
        const groups = parseSelector(sel);
        const walk = (n) => {
            for (const c of n.childNodes) {
                if (c.nodeType !== 1) continue;
                if (groups.some((g) => matchCompound(c, g))) out.push(c);
                walk(c);
            }
        };
        walk(this);
        return out;
    }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    matches(sel) { return parseSelector(sel).some((g) => matchCompound(this, g)); }
    closest(sel) {
        const groups = parseSelector(sel);
        for (let n = this; n && n.nodeType === 1; n = n.parentNode) {
            if (groups.some((g) => matchCompound(n, g))) return n;
        }
        return null;
    }
    scrollIntoView() {}
    focus() {}
    blur() {}
    getBoundingClientRect() { return { x: 0, y: 0, left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }; }
    requestPointerLock() {
        DOC.pointerLockElement = this;
        DOM.lockRequests++;
        DOC.dispatchEvent(new Ev("pointerlockchange", { bubbles: false }));
        return Promise.resolve();
    }
    click() { this.dispatchEvent(new Ev("click", { bubbles: true, button: 0 })); }
}

function serialize(n) {
    if (n.nodeType === 3) return n.data.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    let a = "";
    for (const [k, v] of n._attrs) a += " " + k + '="' + v.replace(/&/g, "&amp;").replace(/"/g, "&quot;") + '"';
    return "<" + n.localName + a + ">" + n.childNodes.map(serialize).join("") + "</" + n.localName + ">";
}

function parseInto(root, html) {
    const stack = [root];
    let i = 0;
    const top = () => stack[stack.length - 1];
    while (i < html.length) {
        const lt = html.indexOf("<", i);
        if (lt < 0) { top().appendChild(new TextNode(decode(html.slice(i)))); break; }
        if (lt > i) top().appendChild(new TextNode(decode(html.slice(i, lt))));
        if (html.startsWith("<!--", lt)) { const e = html.indexOf("-->", lt); i = e < 0 ? html.length : e + 3; continue; }
        const gt = findTagEnd(html, lt);
        const raw = html.slice(lt + 1, gt);
        i = gt + 1;
        if (raw[0] === "/") {
            const name = raw.slice(1).trim().toLowerCase();
            for (let s = stack.length - 1; s > 0; s--) {
                if (stack[s].localName === name) { stack.length = s; break; }
            }
            continue;
        }
        const selfClose = raw.endsWith("/");
        const body = selfClose ? raw.slice(0, -1) : raw;
        const m = /^([a-zA-Z][\w-]*)/.exec(body);
        if (!m) continue;
        const el = new Element(m[1]);
        const attrRe = /([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
        let am;
        const rest = body.slice(m[1].length);
        while ((am = attrRe.exec(rest))) {
            const v = am[2] !== undefined ? am[2] : am[3] !== undefined ? am[3] : am[4] !== undefined ? am[4] : "";
            el.setAttribute(am[1], decode(v));
        }
        top().appendChild(el);
        if (!selfClose && !VOID.has(el.localName)) stack.push(el);
    }
}
function findTagEnd(s, lt) {
    let q = null;
    for (let k = lt + 1; k < s.length; k++) {
        const c = s[k];
        if (q) { if (c === q) q = null; continue; }
        if (c === '"' || c === "'") { q = c; continue; }
        if (c === ">") return k;
    }
    return s.length - 1;
}

// ---- selectors: comma groups of compound selectors (no combinators)
const SEL_CACHE = new Map();
function parseSelector(sel) {
    if (SEL_CACHE.has(sel)) return SEL_CACHE.get(sel);
    const groups = splitTop(sel, ",").map((g) => parseCompound(g.trim()));
    SEL_CACHE.set(sel, groups);
    return groups;
}
function splitTop(s, ch) {
    const out = [];
    let depth = 0, q = null, start = 0;
    for (let k = 0; k < s.length; k++) {
        const c = s[k];
        if (q) { if (c === q) q = null; continue; }
        if (c === '"' || c === "'") q = c;
        else if (c === "(" || c === "[") depth++;
        else if (c === ")" || c === "]") depth--;
        else if (c === ch && depth === 0) { out.push(s.slice(start, k)); start = k + 1; }
    }
    out.push(s.slice(start));
    return out;
}
function parseCompound(s) {
    if (/\s/.test(s.replace(/\[[^\]]*\]|\([^)]*\)/g, ""))) throw new Error("dom shim: combinators unsupported: " + s);
    const c = { tag: null, id: null, cls: [], attrs: [], not: [] };
    let k = 0;
    const tm = /^[a-zA-Z][\w-]*|^\*/.exec(s);
    if (tm) { if (tm[0] !== "*") c.tag = tm[0].toLowerCase(); k = tm[0].length; }
    while (k < s.length) {
        const ch = s[k];
        if (ch === ".") { const m = /^\.([\w-]+)/.exec(s.slice(k)); c.cls.push(m[1]); k += m[0].length; }
        else if (ch === "#") { const m = /^#([\w-]+)/.exec(s.slice(k)); c.id = m[1]; k += m[0].length; }
        else if (ch === "[") {
            const end = s.indexOf("]", k);
            const m = /^\[\s*([\w-]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+)))?\s*\]$/.exec(s.slice(k, end + 1));
            c.attrs.push({ k: m[1], v: m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] });
            k = end + 1;
        } else if (s.startsWith(":not(", k)) {
            let depth = 0, e = k + 4;
            for (; e < s.length; e++) { if (s[e] === "(") depth++; else if (s[e] === ")") { depth--; if (depth === 0) break; } }
            c.not.push(parseCompound(s.slice(k + 5, e).trim()));
            k = e + 1;
        } else throw new Error("dom shim: unsupported selector " + s);
    }
    return c;
}
function matchCompound(el, c) {
    if (c.tag && el.localName !== c.tag) return false;
    if (c.id && el.id !== c.id) return false;
    for (const x of c.cls) if (!el.classList.contains(x)) return false;
    for (const a of c.attrs) {
        if (!el.hasAttribute(a.k)) return false;
        if (a.v !== undefined && el.getAttribute(a.k) !== a.v) return false;
    }
    for (const n of c.not) if (matchCompound(el, n)) return false;
    return true;
}

// ---- document / window
class Doc extends Target {
    constructor() {
        super();
        this.nodeType = 9;
        this.parentNode = null;
        this.documentElement = new Element("html");
        this.head = new Element("head");
        this.body = new Element("body");
        this.documentElement.appendChild(this.head);
        this.documentElement.appendChild(this.body);
        this.documentElement.parentNode = this;
        this.childNodes = [this.documentElement];
        this.pointerLockElement = null;
        this.visibilityState = "visible";
        this.hidden = false;
    }
    createElement(t) { return new Element(t); }
    createTextNode(t) { return new TextNode(t); }
    getElementById(id) { return this.documentElement.querySelector("#" + id); }
    querySelector(s) { return this.documentElement.querySelector(s); }
    querySelectorAll(s) { return this.documentElement.querySelectorAll(s); }
    exitPointerLock() {
        if (!this.pointerLockElement) return;
        this.pointerLockElement = null;
        DOM.lockExits++;
        this.dispatchEvent(new Ev("pointerlockchange", { bubbles: false }));
    }
}
class Win extends Target {}

let DOC = null, WIN = null;
const DOM = { lockRequests: 0, lockExits: 0, raf: [] };

/** Install the shim on globalThis. Returns helpers for the probe. */
export function installDom() {
    WIN = new Win();
    DOC = new Doc();
    globalThis.window = globalThis;
    // window listeners live on the Win object; route the global's methods there.
    globalThis.addEventListener = (t, f, o) => WIN.addEventListener(t, f, o);
    globalThis.removeEventListener = (t, f, o) => WIN.removeEventListener(t, f, o);
    globalThis.dispatchEvent = (e) => WIN.dispatchEvent(e);
    globalThis.document = DOC;
    let rafId = 0;
    globalThis.requestAnimationFrame = (fn) => { DOM.raf.push(fn); return ++rafId; };
    globalThis.cancelAnimationFrame = () => {};
    const canvas = new Element("canvas");
    canvas.id = "view";
    DOC.body.appendChild(canvas);
    return {
        document: DOC, window: WIN, canvas, stats: DOM,
        Event: Ev,
        /** Dispatch a key (target = body, as with no focused input). */
        key(code, opts) {
            const o = Object.assign({ code, key: code, repeat: false, bubbles: true }, opts || {});
            const down = new Ev("keydown", o);
            DOC.body.dispatchEvent(down);
            const up = new Ev("keyup", Object.assign({}, o));
            DOC.body.dispatchEvent(up);
            return down;
        },
        click(el) { const e = new Ev("click", { bubbles: true, button: 0 }); el.dispatchEvent(e); return e; },
        mousemove(el) { el.dispatchEvent(new Ev("mousemove", { bubbles: true })); },
        /** Run the queued rAF callbacks, `n` times (each may queue more). */
        pumpFrames(n, between) {
            for (let k = 0; k < (n || 1); k++) {
                if (between) between();
                const q = DOM.raf;
                DOM.raf = [];
                for (const f of q) f(performance.now());
            }
        },
        lock() { canvas.requestPointerLock(); },
    };
}
