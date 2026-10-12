// ctrlScript --> NativeScript-style web DOM wrapper
// refer to csui_docs.md for info on csui;docs still in progress so u can use this just dont use vanillajs at all. no .el. complicated methods
const containers = [];          // legacy: 1-based numeric index lookup
const containersByName = {};    // recommended: named lookup e.g. "home", "profile"
let elementCounter = 0;

class BaseElement {
    constructor(containerIndex = null) {
        this.el = null;
        this.id = `el_${elementCounter++}`;
        this._props = {};
        this._rotation = null;
        this._pendingContainerIndex = containerIndex;
        this._mountCallbacks = [];
        this._destroyCallbacks = [];
        this._mounted = false;
        this._eventHandlers = {}; // tracks onX handlers for replacement
        console.debug(`[syntax] create ${this.constructor.name}#${this.id} (target container: ${containerIndex ?? 'none'})`);
    }

    set props(obj) {
        Object.keys(obj).forEach(key => {
            const value = obj[key];

            if ((key === 'pos' || key === 'position') && typeof value === 'object' && value !== null) {
                this.setPosition(value);
            } else if (['fullPage', 'fullpage', 'fullscreen', 'fillScreen'].includes(key) && value) {
                // Convenience: make element fill the viewport height and width
                this.setStyle('width', '100%');
                this.setStyle('minHeight', '100vh');
                if (!this.el.style.display) this.setStyle('display', 'block');
            } else if (key === 'name') {
                // Debug-friendly label
                this.el.dataset.name = value;
                if (!this.el.id) this.el.id = value;
            } else if (key === 'children' && Array.isArray(value)) {
                obj[key].forEach(child => this.addChild(child));
            } else if (key.startsWith('on') && typeof value === 'function') {
                const event = key.slice(2).toLowerCase();
                // Remove previous handler for this prop key to prevent stacking
                if (this._eventHandlers[key]) {
                    this.el.removeEventListener(event, this._eventHandlers[key]);
                }
                this.el.addEventListener(event, value);
                this._eventHandlers[key] = value;
            } else if (key === 'text' || key === 'textContent') {
                this.el.textContent = value;
            } else if (key === 'html' || key === 'innerHTML') {
                this.el.innerHTML = value;
            } else if (key === 'size') {
                // convenience: apply to both width and height when supported
                if (typeof this.size === 'function') {
                    this.size(value);
                } else {
                    this.size = value;
                }
            } else if (key === 'rotation') {
                this.rotation = value;
            } else if (key === 'src') {
                if ('src' in this.el) {
                    this.el.src = value;
                } else {
                    this.el.setAttribute('src', value);
                }
            } else if (key === 'href') {
                if ('href' in this.el) {
                    this.el.href = value;
                } else {
                    this.el.setAttribute('href', value);
                }
            } else if (key === 'alt') {
                if ('alt' in this.el) {
                    this.el.alt = value;
                } else {
                    this.el.setAttribute('alt', value);
                }
            } else {
                this.setStyle(key, value);
            }
        });
        this._props = { ...this._props, ...obj };
    }

    get props() {
        return this._props;
    }

    set shift(container) {
        if (this.el.parentNode) {
            this.el.parentNode.removeChild(this.el);
        }
        container.addChild(this);
    }

    setStyle(key, value) {
        const styleMap = {
            // short -> long
            bg: 'backgroundColor',
            bgColor: 'backgroundColor',
            color: 'color',
            c: 'color',
            fs: 'fontSize',
            fontSize: 'fontSize',
            fw: 'fontWeight',
            fontWeight: 'fontWeight',
            w: 'width',
            width: 'width',
            h: 'height',
            height: 'height',
            p: 'padding',
            padding: 'padding',
            m: 'margin',
            margin: 'margin',
            mt: 'marginTop',
            marginTop: 'marginTop',
            mb: 'marginBottom',
            marginBottom: 'marginBottom',
            ml: 'marginLeft',
            marginLeft: 'marginLeft',
            mr: 'marginRight',
            marginRight: 'marginRight',
            pt: 'paddingTop',
            paddingTop: 'paddingTop',
            pb: 'paddingBottom',
            paddingBottom: 'paddingBottom',
            pl: 'paddingLeft',
            paddingLeft: 'paddingLeft',
            pr: 'paddingRight',
            paddingRight: 'paddingRight',
            border: 'border',
            borderRadius: 'borderRadius',
            br: 'borderRadius',
            display: 'display',
            d: 'display',
            flexDirection: 'flexDirection',
            fd: 'flexDirection',
            justifyContent: 'justifyContent',
            jc: 'justifyContent',
            alignItems: 'alignItems',
            ai: 'alignItems',
            gap: 'gap',
            position: 'position',
            pos: 'position',
            top: 'top',
            left: 'left',
            right: 'right',
            bottom: 'bottom',
            zIndex: 'zIndex',
            z: 'zIndex',
            opacity: 'opacity',
            o: 'opacity',
            cursor: 'cursor',
            overflow: 'overflow',
            textAlign: 'textAlign',
            ta: 'textAlign',
            fontFamily: 'fontFamily',
            ff: 'fontFamily',
            lineHeight: 'lineHeight',
            lh: 'lineHeight',
            transform: 'transform',
            transition: 'transition',
            boxShadow: 'boxShadow',
            bs: 'boxShadow',
            minWidth: 'minWidth',
            minW: 'minWidth',
            maxWidth: 'maxWidth',
            maxW: 'maxWidth',
            minHeight: 'minHeight',
            minH: 'minHeight',
            maxHeight: 'maxHeight',
            maxH: 'maxHeight',
        };

        const styleProp = styleMap[key] || key;
        const finalValue = this._shouldAutoPx(styleProp) ? this._normalizeCssValue(value) : value;

        if (this.el.style[styleProp] !== undefined) {
            this.el.style[styleProp] = finalValue;
        } else {
            this.el.setAttribute(key, finalValue);
        }
    }

    addChild(child) {
        if (!this.el) {
            console.error(`[syntax] addChild failed: parent el missing on ${this.constructor.name}#${this.id}`);
            return;
        }

        if (child instanceof BaseElement) {
            if (!child.el) {
                console.error(`[syntax] addChild failed: child el missing on ${child.constructor.name}#${child.id}`);
                return;
            }
            this.el.appendChild(child.el);
            child._triggerMount();
        } else if (child instanceof HTMLElement) {
            this.el.appendChild(child);
        } else {
            console.error('[syntax] addChild expects BaseElement or HTMLElement', child);
        }
    }

    on(event, handler) {
        this.el.addEventListener(event, handler);
        return this;
    }

    set(obj) {
        this.props = obj;
        return this;
    }

    set pos(value) {
        if (typeof value === 'object' && value !== null) {
            this.setPosition(value);
        } else {
            this.setStyle('position', value);
        }
        this._props = { ...this._props, pos: value };
    }

    get pos() {
        return this._props.pos || this._props.position || null;
    }

    set position(value) {
        this.pos = value;
        this._props = { ...this._props, position: value };
    }

    get position() {
        return this.pos;
    }

    // Set both width and height together (used by Image/Square convenience prop)
    set size(value) {
        const normalized = this._normalizeCssValue(value);
        this.setStyle('width', normalized);
        this.setStyle('height', normalized);
        this._props = { ...this._props, size: value };
    }

    get size() {
        return this._props.size || null;
    }

    set rotation(value) {
        const angle = typeof value === 'number' ? `${value}deg` : value;
        const existing = this.el.style.transform || '';
        const withoutRotate = existing.replace(/rotate\([^)]*\)/g, '').trim();
        const pieces = [withoutRotate, angle ? `rotate(${angle})` : ''].filter(Boolean);
        this.el.style.transform = pieces.join(' ').trim();
        this._rotation = angle;
        this._props = { ...this._props, rotation: value };
    }

    get rotation() {
        return this._props.rotation ?? this._rotation;
    }

    setPosition(config) {
        const posValue =
            config.position ||
            config.pos ||
            config.type ||
            config.mode ||
            config.kind ||
            'absolute';

        this.setStyle('position', posValue);

        const map = {
            top: 'top',
            y: 'top',
            left: 'left',
            x: 'left',
            right: 'right',
            bottom: 'bottom',
            z: 'zIndex',
            zIndex: 'zIndex',
        };

        Object.keys(map).forEach(key => {
            if (config[key] !== undefined) {
                this.setStyle(map[key], this._normalizeCssValue(config[key]));
            }
        });
    }

    _normalizeCssValue(value) {
        return typeof value === 'number' ? `${value}px` : value;
    }

    _shouldAutoPx(styleProp) {
        const pxProps = new Set([
            'fontSize',
            'width',
            'height',
            'minWidth',
            'maxWidth',
            'minHeight',
            'maxHeight',
            'top',
            'left',
            'right',
            'bottom',
            'margin',
            'marginTop',
            'marginBottom',
            'marginLeft',
            'marginRight',
            'padding',
            'paddingTop',
            'paddingBottom',
            'paddingLeft',
            'paddingRight',
            'gap',
            'lineHeight',
            'borderRadius',
        ]);
        return pxProps.has(styleProp);
    }

    _describe() {
        const tag = this.el && this.el.tagName ? this.el.tagName.toLowerCase() : 'unknown';
        const domId = this.el && this.el.id ? `#${this.el.id}` : '';
        const friendly = this._props.name || (this.el && this.el.dataset && this.el.dataset.name) || '';
        const namePart = friendly ? ` (${friendly})` : '';
        const text = this.el && this.el.textContent ? this.el.textContent.trim() : '';
        const textPreview = text ? ` "${text.slice(0, 30)}${text.length > 30 ? '…' : ''}"` : '';
        return `${this.constructor.name}#${this.id}${namePart} <${tag}${domId}>${textPreview}`;
    }

    _attachToContainer() {
        let parent = null;
        const ref = this._pendingContainerIndex;

        if (typeof ref === 'string') {
            // ── Named container lookup (recommended) ──
            parent = containersByName[ref] ?? null;
            if (!parent) {
                console.error(`[csui] Container named "${ref}" not found. ` +
                    `Available: [${Object.keys(containersByName).join(', ') || 'none'}]`);
            }
        } else if (typeof ref === 'number') {
            // ── Legacy numeric lookup (1-based, still supported) ──
            parent = containers[ref - 1] ?? null;
            if (!parent) {
                console.error(`[csui] Container index ${ref} not found (${containers.length} registered).`);
            }
        } else if (ref === null) {
            // Auto-attach if exactly one container exists
            if (containers.length === 1 && containers[0] !== this) {
                parent = containers[0];
            }
        }

        if (parent) {
            parent.addChild(this);
            const label = parent._containerName
                ? `"${parent._containerName}"`
                : `#${containers.indexOf(parent) + 1}`;
            console.debug(`[csui] ${this.constructor.name}#${this.id} → container ${label}`);
        } else {
            // Root container (first Box ever) has no parent — that's expected
            if (containers[0] === this) {
                console.debug(`[csui] ${this._describe()} is root container.`);
                this._pendingContainerIndex = null;
                this._triggerMount();
                return;
            }
            if (ref === null && containers.length !== 1 && !this._containerName) {
                const names = Object.keys(containersByName);
                const hint = names.length
                    ? `Named containers: [${names.join(', ')}]`
                    : `No named containers yet. Create one: new Box("home")`;
                console.warn(`[csui] ${this._describe()} not attached. ${hint}`);
            }
        }
        this._pendingContainerIndex = null;
    }

    _triggerMount() {
        if (this._mounted) return;
        this._mounted = true;
        if (this._mountCallbacks.length) {
            Promise.resolve().then(() => this._mountCallbacks.forEach(fn => fn()));
        }
    }

    onMount(fn) {
        this._mountCallbacks.push(fn);
        return this;
    }

    onDestroy(fn) {
        this._destroyCallbacks.push(fn);
        return this;
    }

    destroy() {
        this._destroyCallbacks.forEach(fn => fn());
        if (this.el && this.el.parentNode) this.el.parentNode.removeChild(this.el);
        return this;
    }
}

export class Text extends BaseElement {
    constructor(containerIndex = null, props = {}) {
        super(containerIndex);
        this.el = document.createElement('span');
        this._attachToContainer();
        if (Object.keys(props).length) this.props = props;
    }

    set text(value) {
        this.el.textContent = value;
    }

    get text() {
        return this.el.textContent;
    }

    set tag(tagName) {
        const newEl = document.createElement(tagName);
        newEl.textContent = this.el.textContent;

        // copy all styles and attributes
        Array.from(this.el.attributes).forEach(attr => {
            newEl.setAttribute(attr.name, attr.value);
        });
        newEl.style.cssText = this.el.style.cssText;

        // replace in DOM if already mounted
        if (this.el.parentNode) {
            this.el.parentNode.replaceChild(newEl, this.el);
        }

        this.el = newEl;
    }
}

// Legacy alias
export const Label = Text;

export class Button extends BaseElement {
    constructor(containerIndex = null, props = {}) {
        super(containerIndex);
        this.el = document.createElement('button');
        this._attachToContainer();
        if (Object.keys(props).length) this.props = props;
    }

    set text(value) {
        this.el.textContent = value;
    }

    get text() {
        return this.el.textContent;
    }
}

export class Input extends BaseElement {
    constructor(containerIndex = null, props = {}) {
        super(containerIndex);
        this.el = document.createElement('input');
        this._attachToContainer();
        if (Object.keys(props).length) this.props = props;
    }

    set value(val) {
        this.el.value = val;
    }

    get value() {
        return this.el.value;
    }

    set placeholder(val) {
        this.el.placeholder = val;
    }

    get placeholder() {
        return this.el.placeholder;
    }

    set type(val) {
        this.el.type = val;
    }

    get type() {
        return this.el.type;
    }
}

export class Box extends BaseElement {
    constructor(containerRef = null, props = {}) {
        // If first arg is a plain object (no container ref), treat as props
        if (containerRef !== null && typeof containerRef === 'object' && !Array.isArray(containerRef)) {
            props = containerRef;
            containerRef = null;
        }
        super(containerRef);
        this.el = document.createElement('div');
        containers.push(this);

        // Register under a name if a string was passed as first arg
        if (typeof containerRef === 'string') {
            this._containerName = containerRef;
            if (containersByName[containerRef]) {
                console.warn(`[csui] Container name "${containerRef}" already registered — overwriting.`);
            }
            containersByName[containerRef] = this;
            // Named boxes don't attach TO a parent automatically;
            // they ARE the parent. Reset the pending ref so _attachToContainer skips.
            this._pendingContainerIndex = null;
        }

        this._attachToContainer();
        if (Object.keys(props).length) this.props = props;
    }

    set tag(tagName) {
        const newEl = document.createElement(tagName);

        // copy all children
        while (this.el.firstChild) {
            newEl.appendChild(this.el.firstChild);
        }

        // copy all styles and attributes
        Array.from(this.el.attributes).forEach(attr => {
            newEl.setAttribute(attr.name, attr.value);
        });
        newEl.style.cssText = this.el.style.cssText;

        // replace in DOM if already mounted
        if (this.el.parentNode) {
            this.el.parentNode.replaceChild(newEl, this.el);
        }

        this.el = newEl;
    }
}

// Legacy aliases
export const Container = Box;
export const Div = Box;

class Shape extends BaseElement {
    constructor(containerIndex = null, props = {}, defaults = {}) {
        super(containerIndex);
        this.el = document.createElement('div');
        this.el.style.boxSizing = 'border-box';
        this._attachToContainer();

        const merged = {
            display: 'block',
            backgroundColor: '#d9d9d9',
            ...defaults,
            ...props
        };

        if (Object.keys(merged).length) this.props = merged;
    }
}

export class Rectangle extends Shape {
    constructor(containerIndex = null, props = {}) {
        super(containerIndex, { w: 120, h: 80, ...props });
    }
}

export class Square extends Shape {
    constructor(containerIndex = null, props = {}) {
        const { size, ...rest } = props;
        const finalSize = size || rest.w || rest.width || 80;
        super(containerIndex, { w: finalSize, h: finalSize, ...rest });
    }

    set size(value) {
        const normalized = this._normalizeCssValue(value);
        this.setStyle('width', normalized);
        this.setStyle('height', normalized);
    }

    get size() {
        return this.el.style.width;
    }
}

export class Circle extends Square {
    constructor(containerIndex = null, props = {}) {
        super(containerIndex, { br: '50%', ...props });
    }
}

export class Ellipse extends Shape {
    constructor(containerIndex = null, props = {}) {
        super(containerIndex, { w: 140, h: 90, br: '50%', ...props });
    }
}

export class Line extends Shape {
    constructor(containerIndex = null, props = {}) {
        super(containerIndex, { w: 120, h: 2, bg: '#000', ...props });
    }

    set thickness(value) {
        this.setStyle('height', this._normalizeCssValue(value));
    }

    get thickness() {
        return this.el.style.height;
    }
}

export class Image extends BaseElement {
    constructor(containerIndex = null, props = {}) {
        super(containerIndex);
        this.el = document.createElement('img');
        this._preserveRatio = true;
        this._sizeValue = null;
        this._explicitWidth = null;
        this._explicitHeight = null;
        this.el.style.objectFit = this.el.style.objectFit || 'contain';
        this.el.addEventListener('load', () => this._applyAspect());
        this._attachToContainer();
        if (Object.keys(props).length) this.props = props;
    }

    set size(value) {
        this._sizeValue = value;
        super.size = value;
        this._applyAspect();
    }

    get size() {
        return this._sizeValue;
    }

    set width(value) {
        this._explicitWidth = value;
        this.setStyle('width', this._normalizeCssValue(value));
        this._applyAspect();
    }

    get width() {
        return this._explicitWidth ?? this.el.style.width;
    }

    set height(value) {
        this._explicitHeight = value;
        this.setStyle('height', this._normalizeCssValue(value));
        this._applyAspect();
    }

    get height() {
        return this._explicitHeight ?? this.el.style.height;
    }

    set preserveRatio(val) {
        this._preserveRatio = val !== false;
        this._applyAspect();
    }

    get preserveRatio() {
        return this._preserveRatio;
    }

    set fit(value) {
        this.setStyle('objectFit', value);
    }

    get fit() {
        return this.el.style.objectFit;
    }

    set src(value) {
        this.el.src = value;
    }

    get src() {
        return this.el.src;
    }

    set alt(value) {
        this.el.alt = value;
    }

    get alt() {
        return this.el.alt;
    }

    _applyAspect() {
        if (!this._preserveRatio) return;
        const natW = this.el.naturalWidth;
        const natH = this.el.naturalHeight;
        if (!natW || !natH) return;

        const parsePx = v => {
            if (typeof v === 'number') return v;
            if (typeof v === 'string' && v.trim().endsWith('px')) return parseFloat(v);
            const num = Number(v);
            return Number.isFinite(num) ? num : null;
        };

        if (this._sizeValue !== null && this._sizeValue !== undefined) {
            const s = parsePx(this._sizeValue);
            if (s !== null) {
                if (natW >= natH) {
                    this.setStyle('width', `${s}px`);
                    this.setStyle('height', `${(s * natH) / natW}px`);
                } else {
                    this.setStyle('height', `${s}px`);
                    this.setStyle('width', `${(s * natW) / natH}px`);
                }
            }
            return;
        }

        if (this._explicitWidth !== null && this._explicitHeight === null) {
            const w = parsePx(this._explicitWidth);
            if (w !== null) {
                this.setStyle('width', `${w}px`);
                this.setStyle('height', `${(w * natH) / natW}px`);
            }
            return;
        }

        if (this._explicitHeight !== null && this._explicitWidth === null) {
            const h = parsePx(this._explicitHeight);
            if (h !== null) {
                this.setStyle('height', `${h}px`);
                this.setStyle('width', `${(h * natW) / natH}px`);
            }
        }
        // If both width and height are explicitly provided, keep them (intentional stretch allowed).
    }
}

export class App extends Box {
    constructor(props = {}) {
        super(null, props);
        this.el.id = 'app';
        document.body.appendChild(this.el);

        // default body styles
        document.body.style.margin = '0';
        document.body.style.padding = '0';
        document.body.style.fontFamily = 'system-ui, -apple-system, sans-serif';
    }

    mount(target = document.body) {
        target.appendChild(this.el);
    }
}

export class Heading extends BaseElement {
    constructor(level = 1, containerIndex = null, props = {}) {
        super(containerIndex);
        this.el = document.createElement(`h${level}`);
        this._attachToContainer();
        if (Object.keys(props).length) this.props = props;
    }

    set text(value) {
        this.el.textContent = value;
    }

    get text() {
        return this.el.textContent;
    }
}

export class Paragraph extends BaseElement {
    constructor(containerIndex = null, props = {}) {
        super(containerIndex);
        this.el = document.createElement('p');
        this._attachToContainer();
        if (Object.keys(props).length) this.props = props;
    }

    set text(value) {
        this.el.textContent = value;
    }

    get text() {
        return this.el.textContent;
    }
}

export class TextArea extends BaseElement {
    constructor(containerIndex = null, props = {}) {
        super(containerIndex);
        this.el = document.createElement('textarea');
        this._attachToContainer();
        if (Object.keys(props).length) this.props = props;
    }

    set value(val) {
        this.el.value = val;
    }

    get value() {
        return this.el.value;
    }

    set placeholder(val) {
        this.el.placeholder = val;
    }

    get placeholder() {
        return this.el.placeholder;
    }

    set rows(val) {
        this.el.rows = val;
    }

    set cols(val) {
        this.el.cols = val;
    }
}

export class Link extends BaseElement {
    constructor(containerIndex = null, props = {}) {
        super(containerIndex);
        this.el = document.createElement('a');
        this._attachToContainer();
        if (Object.keys(props).length) this.props = props;
    }

    set text(value) {
        this.el.textContent = value;
    }

    get text() {
        return this.el.textContent;
    }

    set href(value) {
        this.el.href = value;
    }

    get href() {
        return this.el.href;
    }

    set target(value) {
        this.el.target = value;
    }
}

export class Span extends BaseElement {
    constructor(containerIndex = null, props = {}) {
        super(containerIndex);
        this.el = document.createElement('span');
        this._attachToContainer();
        if (Object.keys(props).length) this.props = props;
    }

    set text(value) {
        this.el.textContent = value;
    }

    get text() {
        return this.el.textContent;
    }
}

export class Section extends BaseElement {
    constructor(containerIndex = null, props = {}) {
        super(containerIndex);
        this.el = document.createElement('section');
        this._attachToContainer();
        if (Object.keys(props).length) this.props = props;
    }
}

export class Article extends BaseElement {
    constructor(containerIndex = null, props = {}) {
        super(containerIndex);
        this.el = document.createElement('article');
        this._attachToContainer();
        if (Object.keys(props).length) this.props = props;
    }
}

export class Header extends BaseElement {
    constructor(containerIndex = null, props = {}) {
        super(containerIndex);
        this.el = document.createElement('header');
        this._attachToContainer();
        if (Object.keys(props).length) this.props = props;
    }
}

export class Footer extends BaseElement {
    constructor(containerIndex = null, props = {}) {
        super(containerIndex);
        this.el = document.createElement('footer');
        this._attachToContainer();
        if (Object.keys(props).length) this.props = props;
    }
}

export class Nav extends BaseElement {
    constructor(containerIndex = null, props = {}) {
        super(containerIndex);
        this.el = document.createElement('nav');
        this._attachToContainer();
        if (Object.keys(props).length) this.props = props;
    }
}

export class List extends BaseElement {
    constructor(ordered = false, containerIndex = null, props = {}) {
        super(containerIndex);
        this.el = document.createElement(ordered ? 'ol' : 'ul');
        this._attachToContainer();
        if (Object.keys(props).length) this.props = props;
    }
}

export class ListItem extends BaseElement {
    constructor(containerIndex = null, props = {}) {
        super(containerIndex);
        this.el = document.createElement('li');
        this._attachToContainer();
        if (Object.keys(props).length) this.props = props;
    }

    set text(value) {
        this.el.textContent = value;
    }

    get text() {
        return this.el.textContent;
    }
}

export class Select extends BaseElement {
    constructor(containerIndex = null, props = {}) {
        super(containerIndex);
        this.el = document.createElement('select');
        this._attachToContainer();
        if (Object.keys(props).length) this.props = props;
    }

    addOption(value, text) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = text;
        this.el.appendChild(option);
        return this;
    }

    set value(val) {
        this.el.value = val;
    }

    get value() {
        return this.el.value;
    }
}

export class Checkbox extends BaseElement {
    constructor(containerIndex = null, props = {}) {
        super(containerIndex);
        this.el = document.createElement('input');
        this.el.type = 'checkbox';
        this._attachToContainer();
        if (Object.keys(props).length) this.props = props;
    }

    set checked(val) {
        this.el.checked = val;
    }

    get checked() {
        return this.el.checked;
    }
}

export class Radio extends BaseElement {
    constructor(containerIndex = null, props = {}) {
        super(containerIndex);
        this.el = document.createElement('input');
        this.el.type = 'radio';
        this._attachToContainer();
        if (Object.keys(props).length) this.props = props;
    }

    set name(val) {
        this.el.name = val;
    }

    set checked(val) {
        this.el.checked = val;
    }

    get checked() {
        return this.el.checked;
    }
}

export class Canvas extends BaseElement {
    constructor(containerIndex = null, props = {}) {
        super(containerIndex);
        this.el = document.createElement('canvas');
        this._attachToContainer();
        if (Object.keys(props).length) this.props = props;
    }

    getContext(type = '2d') {
        return this.el.getContext(type);
    }

    set width(val) {
        this.el.width = val;
    }

    get width() {
        return this.el.width;
    }

    set height(val) {
        this.el.height = val;
    }

    get height() {
        return this.el.height;
    }
}

export class Video extends BaseElement {
    constructor(containerIndex = null, props = {}) {
        super(containerIndex);
        this.el = document.createElement('video');
        this._attachToContainer();
        if (Object.keys(props).length) this.props = props;
    }

    set src(value) {
        this.el.src = value;
    }

    get src() {
        return this.el.src;
    }

    set controls(val) {
        this.el.controls = val;
    }

    play() {
        return this.el.play();
    }

    pause() {
        this.el.pause();
    }
}

export class Audio extends BaseElement {
    constructor(containerIndex = null, props = {}) {
        super(containerIndex);
        this.el = document.createElement('audio');
        this._attachToContainer();
        if (Object.keys(props).length) this.props = props;
    }

    set src(value) {
        this.el.src = value;
    }

    get src() {
        return this.el.src;
    }

    set controls(val) {
        this.el.controls = val;
    }

    play() {
        return this.el.play();
    }

    pause() {
        this.el.pause();
    }
}

export class Iframe extends BaseElement {
    constructor(containerIndex = null, props = {}) {
        super(containerIndex);
        this.el = document.createElement('iframe');
        this._attachToContainer();
        if (Object.keys(props).length) this.props = props;
    }

    set src(value) {
        this.el.src = value;
    }

    get src() {
        return this.el.src;
    }
}

export class Code extends BaseElement {
    constructor(containerIndex = null, props = {}) {
        super(containerIndex);
        this.el = document.createElement('code');
        this._attachToContainer();
        if (Object.keys(props).length) this.props = props;
    }

    set text(value) {
        this.el.textContent = value;
    }

    get text() {
        return this.el.textContent;
    }
}

export class CodeBlock extends BaseElement {
    constructor(containerIndex = null, props = {}) {
        super(containerIndex);
        this.el = document.createElement('pre');
        this.codeEl = document.createElement('code');
        this.el.appendChild(this.codeEl);

        // sensible defaults for readability and overflow handling
        const defaults = {
            bg: 'rgba(16, 19, 46, 0.88)',
            color: '#DDEEDF',
            fontFamily: '"Fira Code", "JetBrains Mono", "Cascadia Code", "SFMono-Regular", Consolas, monospace',

            lineHeight: '1.55',
            br: 12,
            p: '16px 18px',
            m: 0,
            border: '1px solid rgba(126, 153, 200, 0.65)',
            boxShadow: '0 18px 36px rgba(0,0,0,0.4)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            overflowX: 'auto',
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
        };

        this.el.style.boxSizing = 'border-box';
        this.el.style.margin = '0';
        this.el.style.whiteSpace = 'pre-wrap';
        this.el.style.wordBreak = 'break-word';
        this.el.style.overflowX = 'auto';

        this.codeEl.style.display = 'block';
        this.codeEl.style.whiteSpace = 'inherit';
        this.codeEl.style.wordBreak = 'inherit';

        const merged = { ...defaults, ...props };
        this._attachToContainer();
        if (Object.keys(merged).length) this.props = merged;
    }

    set props(obj) {
        const { codeProps, ...rest } = obj;
        super.props = rest;
        if (codeProps) {
            this._applyCodeProps(codeProps);
        }
        this._props = { ...this._props, ...obj };
    }

    _applyCodeProps(codeProps) {
        Object.keys(codeProps).forEach(key => {
            const value = codeProps[key];
            if (this.codeEl.style[key] !== undefined) {
                this.codeEl.style[key] = value;
            } else {
                this.codeEl.setAttribute(key, value);
            }
        });
    }

    set text(value) {
        this.codeEl.textContent = value;
    }

    get text() {
        return this.codeEl.textContent;
    }
}

export class Pre extends BaseElement {
    constructor(containerIndex = null, props = {}) {
        super(containerIndex);
        this.el = document.createElement('pre');
        this._attachToContainer();
        if (Object.keys(props).length) this.props = props;
    }

    set text(value) {
        this.el.textContent = value;
    }

    get text() {
        return this.el.textContent;
    }
}

export class Table extends BaseElement {
    constructor(containerIndex = null, props = {}) {
        super(containerIndex);
        this.el = document.createElement('table');
        this._attachToContainer();
        if (Object.keys(props).length) this.props = props;
    }
}

export class TableRow extends BaseElement {
    constructor(containerIndex = null, props = {}) {
        super(containerIndex);
        this.el = document.createElement('tr');
        this._attachToContainer();
        if (Object.keys(props).length) this.props = props;
    }
}

export class TableCell extends BaseElement {
    constructor(isHeader = false, containerIndex = null, props = {}) {
        super(containerIndex);
        this.el = document.createElement(isHeader ? 'th' : 'td');
        this._attachToContainer();
        if (Object.keys(props).length) this.props = props;
    }

    set text(value) {
        this.el.textContent = value;
    }

    get text() {
        return this.el.textContent;
    }
}

export class Form extends BaseElement {
    constructor(containerIndex = null, props = {}) {
        super(containerIndex);
        this.el = document.createElement('div'); // using div instead of form to avoid default submit behavior
        this._attachToContainer();
        if (Object.keys(props).length) this.props = props;
    }
}

export class HR extends BaseElement {
    constructor(containerIndex = null, props = {}) {
        super(containerIndex);
        this.el = document.createElement('hr');
        this._attachToContainer();
        if (Object.keys(props).length) this.props = props;
    }
}

export class BR extends BaseElement {
    constructor(containerIndex = null, props = {}) {
        super(containerIndex);
        this.el = document.createElement('br');
        this._attachToContainer();
        if (Object.keys(props).length) this.props = props;
    }
}

// utility to clear all containers (useful for rerenders)
export function clearContainers() {
    containers.length = 0;
    for (const k in containersByName) delete containersByName[k];
    elementCounter = 0;
}

// utility to remove an element
export function remove(element) {
    if (element instanceof BaseElement && element.el.parentNode) {
        element.el.parentNode.removeChild(element.el);
    }
}

// utility to get container by index (number) OR name (string)
export function getContainer(ref) {
    if (typeof ref === 'string') return containersByName[ref] ?? null;
    return containers[ref - 1] ?? null;
}

// list all named containers
export function listContainers() {
    return { named: { ...containersByName }, indexed: [...containers] };
}

// ============================================================
// ✦ CSUI EXTENDED FEATURES — built on top of base syntax
// ============================================================

// ──────────────────────────────────────────────────────
// §1  CHAINING API
//     box.bg("red").p(10).w(200).x(50).center()
// ──────────────────────────────────────────────────────
;(function _addChainingAPI() {
    const proto = BaseElement.prototype;
    const px = v => typeof v === 'number' ? `${v}px` : v;

    const _style = (prop, val) => function(v) {
        this.el.style[prop] = px(v);
        return this;
    };

    // single-value style method helpers
    const methods = {
        w:   'width', h:  'height',
        p:   'padding', m: 'margin',
        mt:  'marginTop',   mb: 'marginBottom',
        ml:  'marginLeft',  mr: 'marginRight',
        pt:  'paddingTop',  pb: 'paddingBottom',
        pl:  'paddingLeft', pr: 'paddingRight',
        br:  'borderRadius',
        o:   'opacity',     z:  'zIndex',
        fs:  'fontSize',    fw: 'fontWeight',
        ff:  'fontFamily',  ta: 'textAlign',
        d:   'display',     bs: 'boxShadow',
        cur: 'cursor',
    };
    for (const [name, cssProp] of Object.entries(methods)) {
        proto[name] = function(v) { this.el.style[cssProp] = px(v); return this; };
    }

    // dual-value helpers
    proto.mx = function(v) { this.el.style.marginLeft = px(v); this.el.style.marginRight = px(v); return this; };
    proto.my = function(v) { this.el.style.marginTop  = px(v); this.el.style.marginBottom = px(v); return this; };
    proto.px = function(v) { this.el.style.paddingLeft = px(v); this.el.style.paddingRight = px(v); return this; };
    proto.py = function(v) { this.el.style.paddingTop = px(v); this.el.style.paddingBottom = px(v); return this; };

    // bg / c with full value pass-through (colors are not px)
    proto.bg = function(v) { this.el.style.backgroundColor = v; return this; };
    proto.c  = function(v) { this.el.style.color = v; return this; };

    // color helpers
    proto.bgRGB = function(r, g, b) { this.el.style.backgroundColor = `rgb(${r},${g},${b})`; return this; };
    proto.bgHSL = function(h, s, l) { this.el.style.backgroundColor = `hsl(${h},${s}%,${l}%)`; return this; };

    // positional helpers — read/write
    proto.x = function(v) {
        if (v === undefined) return parseFloat(this.el.style.left) || 0;
        if (!this.el.style.position) this.el.style.position = 'absolute';
        this.el.style.left = px(v);
        return this;
    };
    proto.y = function(v) {
        if (v === undefined) return parseFloat(this.el.style.top) || 0;
        if (!this.el.style.position) this.el.style.position = 'absolute';
        this.el.style.top = px(v);
        return this;
    };

    // center in parent using absolute + transform
    proto.center = function() {
        this.el.style.position  = 'absolute';
        this.el.style.left      = '50%';
        this.el.style.top       = '50%';
        this.el.style.transform = 'translate(-50%,-50%)';
        return this;
    };

    // debug highlight
    proto.highlight = function(color = '#f00') {
        this.el.style.outline = `2px solid ${color}`;
        return this;
    };
})();


// ──────────────────────────────────────────────────────
// §2  BUTTON — .click() shorthand
// ──────────────────────────────────────────────────────
Button.prototype.click = function(fn) {
    this.el.addEventListener('click', fn);
    return this;
};


// ──────────────────────────────────────────────────────
// §3  INPUT — .get() / .set() / .onInput() / .onEnter()
// ──────────────────────────────────────────────────────
Input.prototype.get = function() { return this.el.value; };
Input.prototype.set = function(v) { this.el.value = v; return this; };
Input.prototype.onInput = function(fn) {
    this.el.addEventListener('input', e => fn(e.target.value));
    return this;
};
Input.prototype.onEnter = function(fn) {
    this.el.addEventListener('keydown', e => {
        if (e.key === 'Enter') fn(e.target.value);
    });
    return this;
};


// ──────────────────────────────────────────────────────
// §4  ANIMATION SYSTEM
//     el.animate({ opacity:0, x:100 }, 300)
//     el.fadeIn() / fadeOut() / slideLeft() / slideRight()
//     el.slideUp() / slideDown()
// ──────────────────────────────────────────────────────
BaseElement.prototype.animate = function(props, duration = 300, easing = 'ease') {
    const el = this.el;
    const px = v => typeof v === 'number' ? `${v}px` : v;

    // build CSS transition list
    const trans = [];
    if ('opacity' in props)    trans.push(`opacity ${duration}ms ${easing}`);
    if ('x' in props || 'y' in props || 'scale' in props || 'rotate' in props)
                                trans.push(`transform ${duration}ms ${easing}`);
    if ('width'  in props)     trans.push(`width ${duration}ms ${easing}`);
    if ('height' in props)     trans.push(`height ${duration}ms ${easing}`);
    if ('backgroundColor' in props) trans.push(`background-color ${duration}ms ${easing}`);
    if ('color' in props)      trans.push(`color ${duration}ms ${easing}`);

    if (trans.length) {
        const existing = el.style.transition ? el.style.transition + ',' : '';
        el.style.transition = existing + trans.join(',');
    }

    // apply after 2 frames so browser registers initial state first
    requestAnimationFrame(() => requestAnimationFrame(() => {
        if ('opacity' in props) el.style.opacity = props.opacity;
        if ('width'  in props) el.style.width  = px(props.width);
        if ('height' in props) el.style.height = px(props.height);
        if ('backgroundColor' in props) el.style.backgroundColor = props.backgroundColor;
        if ('color' in props)  el.style.color = props.color;

        // transform
        if ('x' in props || 'y' in props || 'scale' in props || 'rotate' in props) {
            let t = (el.style.transform || '')
                .replace(/translateX\([^)]*\)/g, '')
                .replace(/translateY\([^)]*\)/g, '')
                .replace(/scale\([^)]*\)/g, '')
                .replace(/rotate\([^)]*\)/g, '')
                .trim();
            if ('x' in props)      t += ` translateX(${px(props.x)})`;
            if ('y' in props)      t += ` translateY(${px(props.y)})`;
            if ('scale' in props)  t += ` scale(${props.scale})`;
            if ('rotate' in props) t += ` rotate(${typeof props.rotate === 'number' ? props.rotate + 'deg' : props.rotate})`;
            el.style.transform = t.trim();
        }
    }));

    return this;
};

BaseElement.prototype.fadeIn = function(d = 300) {
    this.el.style.opacity = '0';
    return this.animate({ opacity: 1 }, d);
};
BaseElement.prototype.fadeOut = function(d = 300) {
    return this.animate({ opacity: 0 }, d);
};
BaseElement.prototype.slideLeft = function(dist = 40, d = 300) {
    this.el.style.transform = (this.el.style.transform || '') + ` translateX(${dist}px)`;
    return this.animate({ x: 0 }, d);
};
BaseElement.prototype.slideRight = function(dist = 40, d = 300) {
    this.el.style.transform = (this.el.style.transform || '') + ` translateX(-${dist}px)`;
    return this.animate({ x: 0 }, d);
};
BaseElement.prototype.slideUp = function(dist = 40, d = 300) {
    this.el.style.transform = (this.el.style.transform || '') + ` translateY(${dist}px)`;
    return this.animate({ y: 0 }, d);
};
BaseElement.prototype.slideDown = function(dist = 40, d = 300) {
    this.el.style.transform = (this.el.style.transform || '') + ` translateY(-${dist}px)`;
    return this.animate({ y: 0 }, d);
};


// ──────────────────────────────────────────────────────
// §5  LAYOUT — methods on Box, CSUI chaining style
//
//  new Box(1).row(a, b, c)    — flex row, adds children
//  new Box(1).col(a, b, c)    — flex column, adds children
//  new Box(1).row()           — just set flex-row, no children
//  box.move(x, y)             — translate (useful for groups)
//
//  Usage:
//    const nav = new Box(1).row(logo, btn).bg("#111").p(12)
//    const form = new Box(1).col(label, input, submit).gap(8)
// ──────────────────────────────────────────────────────

// Helper: append BaseElement or HTMLElement children
function _appendChildren(box, children) {
    children.forEach(c => {
        if (c instanceof BaseElement) box.el.appendChild(c.el);
        else if (c instanceof HTMLElement) box.el.appendChild(c);
    });
}

// .row(...children) — turns Box into a flex row, optionally adds children
Box.prototype.row = function(...children) {
    this.el.style.display        = 'flex';
    this.el.style.flexDirection  = 'row';
    this.el.style.alignItems     = 'center';
    _appendChildren(this, children);
    return this;
};

// .col(...children) — turns Box into a flex column, optionally adds children
Box.prototype.col = function(...children) {
    this.el.style.display       = 'flex';
    this.el.style.flexDirection = 'column';
    _appendChildren(this, children);
    return this;
};

// .move(x, y) — translate element, handy for grouped boxes
Box.prototype.move = function(x, y) {
    this.el.style.transform = `translate(${x}px,${y}px)`;
    return this;
};

// group(...children) — Box with position:relative, for layering/overlap
export function group(...children) {
    const b = new Box(null);
    b.el.style.position = 'relative';
    _appendChildren(b, children);
    return b;
}


// ──────────────────────────────────────────────────────
// §6  GAME SYSTEM
// ──────────────────────────────────────────────────────

// game loop
export function loop(fn) {
    let running = true, last = performance.now();
    function tick(now) {
        if (!running) return;
        fn(now - last);
        last = now;
        requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
    return { stop() { running = false; } };
}

// keyboard input
const _keys = {};
window.addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    if (!_keys[k]) _keys[k] = { down: [], up: [] };
    _keys[k].down.forEach(fn => fn(e));
});
window.addEventListener('keyup', e => {
    const k = e.key.toLowerCase();
    if (_keys[k]) _keys[k].up.forEach(fn => fn(e));
});

export function onKey(key, fn, { up = false } = {}) {
    const k = key.toLowerCase();
    if (!_keys[k]) _keys[k] = { down: [], up: [] };
    _keys[k][up ? 'up' : 'down'].push(fn);
}

// collision (AABB)
export function collides(a, b) {
    const r1 = (a instanceof BaseElement ? a.el : a).getBoundingClientRect();
    const r2 = (b instanceof BaseElement ? b.el : b).getBoundingClientRect();
    return !(r1.right < r2.left || r1.left > r2.right || r1.bottom < r2.top || r1.top > r2.bottom);
}

// scene manager
const _scenes = {};
export function scene(name, fn) { _scenes[name] = fn; }
export async function go(name) {
    if (!_scenes[name]) { console.error(`[csui] scene "${name}" not found`); return; }
    const root = document.getElementById('app') || document.body;
    const old = root.querySelector('[data-csui-scene]');
    if (old) old.remove();
    const wrap = document.createElement('div');
    wrap.dataset.csuiScene = name;
    wrap.style.cssText = 'width:100%;height:100%';
    root.appendChild(wrap);
    // temporarily push a fake container so children attach here
    const fakeBox = Object.create(Box.prototype);
    BaseElement.call(fakeBox, null);
    fakeBox.el = wrap;
    containers.push(fakeBox);
    // support both plain functions and async loaders: () => import('./scene.js')
    let result = _scenes[name]();
    if (result && typeof result.then === 'function') {
        result = await result;
        // if it resolved to a module, call its default export
        if (result && typeof result.default === 'function') result.default();
    }
}

// camera
export const camera = (() => {
    let _x = 0, _y = 0, _layer = null;
    function layer() {
        if (!_layer) {
            _layer = document.createElement('div');
            _layer.id = '_csui_cam';
            _layer.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%';
            (document.getElementById('app') || document.body).appendChild(_layer);
        }
        return _layer;
    }
    function apply() { layer().style.transform = `translate(${-_x}px,${-_y}px)`; }
    return {
        get x() { return _x; }, set x(v) { _x = v; apply(); },
        get y() { return _y; }, set y(v) { _y = v; apply(); },
        get el() { return layer(); },
    };
})();


// ──────────────────────────────────────────────────────
// §7  TIMER HELPERS
// ──────────────────────────────────────────────────────
export function after(ms, fn) { return setTimeout(fn, ms); }
export function every(ms, fn) {
    const id = setInterval(fn, ms);
    return { stop() { clearInterval(id); } };
}


// ──────────────────────────────────────────────────────
// §8  STORAGE
// ──────────────────────────────────────────────────────
export function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch(e) { console.warn('[csui] save failed:', e); }
}
export function load(key, defaultValue = null) {
    try {
        const raw = localStorage.getItem(key);
        return raw !== null ? JSON.parse(raw) : defaultValue;
    } catch(e) { return defaultValue; }
}


// ──────────────────────────────────────────────────────
// §9  PROMPT HELPER
// ──────────────────────────────────────────────────────
export function ask(message, defaultVal = '') {
    return window.prompt(message, defaultVal);
}


// ──────────────────────────────────────────────────────
// §10  SOUND MODULE
//      sound.load("hit","hit.ogg")
//      sound.play("hit")  sound.stop("hit")
// ──────────────────────────────────────────────────────
export const sound = (() => {
    const _s = {};
    return {
        load(name, url) { const a = new window.Audio(url); a.preload = 'auto'; _s[name] = a; return this; },
        play(name, { loop: lp = false, volume: vol = 1 } = {}) {
            if (!_s[name]) { console.warn(`[csui] sound "${name}" not loaded`); return this; }
            const c = _s[name].cloneNode();
            c.loop = lp; c.volume = vol;
            c.play().catch(() => {});
            _s[`${name}_last`] = c;
            return this;
        },
        stop(name) { const a = _s[`${name}_last`] || _s[name]; if (a) { a.pause(); a.currentTime = 0; } return this; },
        volume(name, vol) { if (_s[name]) _s[name].volume = vol; return this; },
    };
})();


// ──────────────────────────────────────────────────────
// §11  PARTICLES  (CSS keyframe, no canvas)
//      particles.emit({ x, y, count, color, size, duration, spread })
// ──────────────────────────────────────────────────────
export const particles = (() => {
    const _st = document.createElement('style');
    _st.textContent = `@keyframes _csuiP{0%{transform:translate(0,0) scale(1);opacity:1}100%{transform:var(--tx) var(--ty) scale(0);opacity:0}}`;
    document.head.appendChild(_st);
    return {
        emit({ x = 0, y = 0, count = 12, color = '#fff', size = 6, duration = 600, spread = 60 } = {}) {
            const root = document.getElementById('app') || document.body;
            for (let i = 0; i < count; i++) {
                const angle = (i / count) * Math.PI * 2;
                const dist  = spread * (0.5 + Math.random() * 0.5);
                const d = document.createElement('div');
                d.style.cssText = [
                    `position:absolute;left:${x}px;top:${y}px`,
                    `width:${size}px;height:${size}px;border-radius:50%`,
                    `background:${color};pointer-events:none;z-index:9999`,
                    `--tx:translateX(${(Math.cos(angle)*dist).toFixed(1)}px)`,
                    `--ty:translateY(${(Math.sin(angle)*dist).toFixed(1)}px)`,
                    `animation:_csuiP ${duration}ms ease-out forwards`,
                ].join(';');
                root.appendChild(d);
                setTimeout(() => d.remove(), duration + 50);
            }
        },
    };
})();


// ──────────────────────────────────────────────────────
// §12  ENGINE2D  (Matter.js physics, lazy CDN load)
//      import { engine2d } from 'csui.js'
//      engine2d.init().then(() => { box.physics({ mass:1, bounce:0.8 }) })
// ──────────────────────────────────────────────────────
const _MATTER_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/matter-js/0.19.0/matter.min.js';
let _matterPromise = null;

function _loadMatter() {
    if (_matterPromise) return _matterPromise;
    if (window.Matter) return (_matterPromise = Promise.resolve(window.Matter));
    _matterPromise = new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = _MATTER_CDN;
        s.onload  = () => res(window.Matter);
        s.onerror = () => rej(new Error('[csui] Matter.js load failed'));
        document.head.appendChild(s);
    });
    return _matterPromise;
}

export const engine2d = (() => {
    let _engine = null;
    const _bodyMap = new Map(); // el -> Matter body

    return {
        init({ gravity = { x: 0, y: 1 } } = {}) {
            return _loadMatter().then(M => {
                _engine = M.Engine.create();
                _engine.gravity.x = gravity.x;
                _engine.gravity.y = gravity.y;
                M.Runner.run(M.Runner.create(), _engine);
                // sync DOM every frame
                loop(() => {
                    _bodyMap.forEach((body, el) => {
                        el.style.left = `${body.position.x - parseFloat(el.style.width)/2}px`;
                        el.style.top  = `${body.position.y - parseFloat(el.style.height)/2}px`;
                    });
                });
                return _engine;
            });
        },
        attach(element, { mass = 1, bounce = 0.5, friction = 0.1, isStatic = false } = {}) {
            if (!_engine) { console.warn('[csui] Call engine2d.init() first'); return Promise.resolve(); }
            return _loadMatter().then(M => {
                const r = element.el.getBoundingClientRect();
                const body = M.Bodies.rectangle(r.left + r.width/2, r.top + r.height/2, r.width, r.height,
                    { mass, restitution: bounce, friction, isStatic });
                M.World.add(_engine.world, body);
                element.el.style.position = 'absolute';
                _bodyMap.set(element.el, body);
                element._physicsBody = body;
                return body;
            });
        },
        addGround(y, width = window.innerWidth, height = 20) {
            return _loadMatter().then(M => {
                const g = M.Bodies.rectangle(width/2, y, width, height, { isStatic: true });
                M.World.add(_engine.world, g);
                return g;
            });
        },
    };
})();

// convenience: box.physics(opts)
BaseElement.prototype.physics = function(opts = {}) {
    engine2d.attach(this, opts);
    return this;
};


// ──────────────────────────────────────────────────────
// §13  DEV TOOLS
//      csui.debug(true)   csui.strict(true)
//      window.onerror  →  showErrorScreen
// ──────────────────────────────────────────────────────
const _devState = { debug: false, strict: false };

function _showErrorScreen(msg) {
    const old = document.getElementById('_csuiErr');
    if (old) old.remove();
    const el = document.createElement('div');
    el.id = '_csuiErr';
    el.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(20,0,0,.93);color:#ff6b6b;font-family:monospace;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2rem;text-align:center';
    el.innerHTML = `<div style="font-size:2rem;margin-bottom:1rem">💥 CSUI Error</div>
<pre style="background:#1a0000;padding:1rem;border-radius:8px;max-width:80%;overflow:auto;white-space:pre-wrap;color:#ffaaaa">${String(msg).replace(/</g,'&lt;')}</pre>
<button onclick="this.parentElement.remove()" style="margin-top:1.5rem;padding:.5rem 1.5rem;background:#ff6b6b;color:#000;border:none;border-radius:6px;cursor:pointer;font-size:1rem">Dismiss</button>`;
    document.body.appendChild(el);
}

window.addEventListener('error',              e => { if (_devState.debug) _showErrorScreen(e.message + (e.filename ? `\n@ ${e.filename}:${e.lineno}` : '')); });
window.addEventListener('unhandledrejection', e => { if (_devState.debug) _showErrorScreen('Promise rejection:\n' + (e.reason?.stack || e.reason)); });

export const csui = {
    debug(on = true)  { _devState.debug  = on; if(on) console.info('[csui] debug ON');  return this; },
    strict(on = true) { _devState.strict = on; if(on) console.info('[csui] strict ON'); return this; },
    showError: _showErrorScreen,
    get isDebug()  { return _devState.debug; },
    get isStrict() { return _devState.strict; },
};

// overlap detection
export function checkOverlap(a, b) {
    if (!collides(a, b)) return false;
    const nA = a._props?.name || a.id, nB = b._props?.name || b.id;
    console.warn(`[csui] "${nA}" overlaps with "${nB}"`);
    return true;
}


// ──────────────────────────────────────────────────────
// §16  ROUTER  (URL-based — keeps scene()/go() intact)
//      router.define("/", fn)
//      router.go("/about")   router.back()   router.forward()
// ──────────────────────────────────────────────────────
export const router = (() => {
    const _routes = {};

    function _run(path) {
        const fn = _routes[path] || _routes['*'];
        if (fn) fn(path);
        else console.warn(`[csui] router: no route for "${path}"`);
    }

    window.addEventListener('popstate', () => _run(location.pathname));

    return {
        define(path, fn) { _routes[path] = fn; },
        go(path, data = null) { history.pushState(data, '', path); _run(path); },
        back()    { history.back(); },
        forward() { history.forward(); },
        get current() { return location.pathname; },
    };
})();


// ──────────────────────────────────────────────────────
// §17  DEVICE APIs  (browser-native wrappers)
//      device.location()  device.vibrate(ms)
//      device.tilt(fn)    device.notify(t,b)
//      device.clipboard.copy(txt) / paste()
// ──────────────────────────────────────────────────────
export const device = {
    location() {
        return new Promise((res, rej) => {
            if (!navigator.geolocation)
                return rej(new Error('[csui] Geolocation not supported'));
            navigator.geolocation.getCurrentPosition(
                p => res({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
                rej
            );
        });
    },
    vibrate(pattern) {
        if (navigator.vibrate) navigator.vibrate(pattern);
        else console.warn('[csui] Vibration API not supported');
    },
    tilt(fn) {
        if (typeof DeviceOrientationEvent === 'undefined') {
            console.warn('[csui] DeviceOrientation not supported');
            return () => {};
        }
        const handler = e => fn(e.alpha, e.beta, e.gamma);
        window.addEventListener('deviceorientation', handler);
        return () => window.removeEventListener('deviceorientation', handler);
    },
    async notify(title, body = '') {
        if (!('Notification' in window)) { console.warn('[csui] Notifications not supported'); return; }
        if (Notification.permission === 'default') await Notification.requestPermission();
        if (Notification.permission === 'granted') new Notification(title, { body });
    },
    clipboard: {
        copy:  text => navigator.clipboard?.writeText(text)  ?? Promise.reject(new Error('[csui] Clipboard API not supported')),
        paste: ()   => navigator.clipboard?.readText()       ?? Promise.reject(new Error('[csui] Clipboard API not supported')),
    },
};


// ──────────────────────────────────────────────────────
// §18  UI COMPONENTS
//      DropdownMenu · Modal · toast · Tabs · Slider
//      ProgressBar · Toggle · Accordion · Drawer
//      Chip · Card
// ──────────────────────────────────────────────────────

export class DropdownMenu extends BaseElement {
    constructor(containerRef = null, props = {}) {
        const {
            items = [], label = 'Menu',
            buttonBg = '#2d2d2d', buttonColor = '#fff', buttonHoverBg = '#3d3d3d',
            menuBg = '#1e1e1e', itemColor = '#e0e0e0', itemHoverBg = '#2d2d3e',
            fontSize = '14px', radius = '8px',
            shadow = '0 8px 24px rgba(0,0,0,0.4)',
            minWidth = '160px', border = '1px solid rgba(255,255,255,0.08)',
            ...rest
        } = props;

        super(containerRef);
        this._isOpen = false;
        this._itemColor = itemColor;
        this._itemHoverBg = itemHoverBg;
        this._fontSize = fontSize;
        this._buttonBg = buttonBg;
        this._buttonHoverBg = buttonHoverBg;

        this.el = document.createElement('div');
        this.el.style.cssText = 'position:relative;display:inline-block';

        this._btn = document.createElement('button');
        this._btn.textContent = label;
        Object.assign(this._btn.style, {
            cursor: 'pointer', padding: '8px 16px',
            background: buttonBg, color: buttonColor,
            border: 'none', borderRadius: radius,
            fontSize, transition: 'background 150ms',
        });
        this._btn.addEventListener('mouseenter', () => { this._btn.style.background = buttonHoverBg; });
        this._btn.addEventListener('mouseleave', () => { this._btn.style.background = this._isOpen ? buttonHoverBg : buttonBg; });

        this._menu = document.createElement('div');
        Object.assign(this._menu.style, {
            position: 'absolute', top: 'calc(100% + 4px)', left: '0',
            minWidth, background: menuBg, borderRadius: radius,
            boxShadow: shadow, border, zIndex: '1000',
            display: 'none', overflow: 'hidden',
        });

        items.forEach(item => this._addItem(item));

        this._btn.addEventListener('click', e => { e.stopPropagation(); this.toggle(); });
        const _docClick = () => this.close();
        document.addEventListener('click', _docClick);
        this.onDestroy(() => document.removeEventListener('click', _docClick));

        this.el.appendChild(this._btn);
        this.el.appendChild(this._menu);
        this._attachToContainer();
        if (Object.keys(rest).length) this.props = rest;
    }

    _addItem({ label, onClick, divider = false }) {
        if (divider) {
            const d = document.createElement('div');
            d.style.cssText = 'height:1px;background:rgba(255,255,255,0.08);margin:4px 0';
            this._menu.appendChild(d);
            return;
        }
        const item = document.createElement('div');
        item.textContent = label;
        Object.assign(item.style, {
            padding: '10px 16px', cursor: 'pointer',
            color: this._itemColor, fontSize: this._fontSize,
            transition: 'background 100ms', userSelect: 'none',
        });
        item.addEventListener('mouseenter', () => { item.style.background = this._itemHoverBg; });
        item.addEventListener('mouseleave', () => { item.style.background = ''; });
        if (onClick) item.addEventListener('click', e => { e.stopPropagation(); onClick(); this.close(); });
        this._menu.appendChild(item);
    }

    open() {
        this._menu.style.top = 'calc(100% + 4px)';
        this._menu.style.bottom = 'auto';
        this._menu.style.display = 'block';
        this._isOpen = true;
        requestAnimationFrame(() => {
            const r = this._menu.getBoundingClientRect();
            if (r.bottom > window.innerHeight) {
                this._menu.style.top = 'auto';
                this._menu.style.bottom = 'calc(100% + 4px)';
            }
        });
        return this;
    }
    close()  { this._menu.style.display = 'none';  this._isOpen = false; return this; }
    toggle() { this._isOpen ? this.close() : this.open(); return this; }
    addItem(item) { this._addItem(item); return this; }

    set label(v) { this._btn.textContent = v; }
    get label()  { return this._btn.textContent; }
}


export class Modal extends BaseElement {
    constructor(containerRef = null, props = {}) {
        const {
            title = '', content = '',
            overlayColor = 'rgba(0,0,0,0.65)',
            dialogBg = '#1a1a2e', titleColor = '#fff',
            contentColor = 'rgba(255,255,255,0.8)',
            radius = '12px', padding = '28px', maxWidth = '500px',
            shadow = '0 24px 64px rgba(0,0,0,0.5)',
            border = '1px solid rgba(255,255,255,0.08)',
            onClose = null, closeOnOverlay = true, showClose = true,
            ...rest
        } = props;

        super(null);
        this._onClose = onClose;

        this.el = document.createElement('div');
        Object.assign(this.el.style, {
            position: 'fixed', inset: '0', zIndex: '10000',
            background: overlayColor, display: 'none',
            alignItems: 'center', justifyContent: 'center',
            backdropFilter: 'blur(2px)',
        });

        this._dialog = document.createElement('div');
        Object.assign(this._dialog.style, {
            background: dialogBg, borderRadius: radius,
            padding, width: '90vw', maxWidth,
            boxShadow: shadow, border,
            position: 'relative', maxHeight: '85vh', overflowY: 'auto',
        });

        this._titleEl = document.createElement('div');
        Object.assign(this._titleEl.style, {
            fontSize: '18px', fontWeight: '700', color: titleColor,
            marginBottom: '14px', paddingRight: showClose ? '28px' : '0',
        });
        this._titleEl.textContent = title;

        this._contentEl = document.createElement('div');
        Object.assign(this._contentEl.style, {
            fontSize: '14px', color: contentColor, lineHeight: '1.65',
        });
        this._setContent(content);

        if (showClose) {
            const x = document.createElement('button');
            x.textContent = '×';
            Object.assign(x.style, {
                position: 'absolute', top: '14px', right: '16px',
                background: 'none', border: 'none', color: titleColor,
                fontSize: '22px', cursor: 'pointer', opacity: '0.5',
                lineHeight: '1', padding: '0 4px', transition: 'opacity 150ms',
            });
            x.addEventListener('mouseenter', () => { x.style.opacity = '1'; });
            x.addEventListener('mouseleave', () => { x.style.opacity = '0.5'; });
            x.addEventListener('click', () => this.close());
            this._dialog.appendChild(x);
        }

        if (closeOnOverlay) {
            this.el.addEventListener('click', e => { if (e.target === this.el) this.close(); });
        }

        this._dialog.appendChild(this._titleEl);
        this._dialog.appendChild(this._contentEl);
        this.el.appendChild(this._dialog);
        document.body.appendChild(this.el);
        this._triggerMount();
        if (Object.keys(rest).length) this.props = rest;
    }

    _setContent(v) {
        this._contentEl.innerHTML = '';
        if (typeof v === 'string') this._contentEl.textContent = v;
        else if (v instanceof BaseElement) this._contentEl.appendChild(v.el);
        else if (v instanceof HTMLElement) this._contentEl.appendChild(v);
    }

    open()  { this.el.style.display = 'flex'; return this; }
    close() { this.el.style.display = 'none'; if (this._onClose) this._onClose(); return this; }

    set title(v)   { this._titleEl.textContent = v; }
    get title()    { return this._titleEl.textContent; }
    set content(v) { this._setContent(v); }
}


const _toastContainers = new Map();
function _getToastContainer(position) {
    if (_toastContainers.has(position)) return _toastContainers.get(position);
    const isBottom = position.startsWith('b');
    const isLeft   = position.endsWith('l');
    const c = document.createElement('div');
    Object.assign(c.style, {
        position: 'fixed', zIndex: '99999', pointerEvents: 'none',
        display: 'flex', flexDirection: isBottom ? 'column-reverse' : 'column',
        gap: '8px', maxWidth: '320px',
        top:    isBottom ? 'auto' : '24px',
        bottom: isBottom ? '24px' : 'auto',
        left:   isLeft   ? '24px' : 'auto',
        right:  isLeft   ? 'auto' : '24px',
    });
    document.body.appendChild(c);
    _toastContainers.set(position, c);
    return c;
}

export function toast(message, {
    type = 'info', duration = 2500, bg = null, color = '#fff',
    position = 'br', radius = '10px', fontSize = '14px',
    shadow = '0 4px 20px rgba(0,0,0,0.35)',
} = {}) {
    const typeColors = { success: '#22c55e', error: '#ef4444', info: '#3b82f6', warning: '#f59e0b' };
    const finalBg = bg || typeColors[type] || typeColors.info;
    const isBottom = position.startsWith('b');
    const container = _getToastContainer(position);

    const t = document.createElement('div');
    t.textContent = message;
    Object.assign(t.style, {
        background: finalBg, color,
        padding: '12px 20px', borderRadius: radius,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize, fontWeight: '500', boxShadow: shadow,
        opacity: '0', pointerEvents: 'auto',
        transform: isBottom ? 'translateY(12px)' : 'translateY(-12px)',
        transition: 'opacity 250ms, transform 250ms',
        lineHeight: '1.4',
    });
    container.appendChild(t);

    requestAnimationFrame(() => requestAnimationFrame(() => {
        t.style.opacity = '1';
        t.style.transform = 'translateY(0)';
    }));
    setTimeout(() => {
        t.style.opacity = '0';
        t.style.transform = isBottom ? 'translateY(12px)' : 'translateY(-12px)';
        setTimeout(() => t.remove(), 300);
    }, duration);
}


export class Tabs extends BaseElement {
    constructor(containerRef = null, props = {}) {
        const {
            tabs = [],
            activeBg = 'transparent', activeColor = '#fff',
            inactiveColor = 'rgba(255,255,255,0.45)',
            barBg = 'transparent', indicatorColor = '#3b82f6',
            radius = '0', gap = '0', fontSize = '14px',
            ...rest
        } = props;

        super(containerRef);
        this.el = document.createElement('div');

        this._bar = document.createElement('div');
        Object.assign(this._bar.style, {
            display: 'flex', gap,
            background: barBg,
            borderBottom: '1px solid rgba(255,255,255,0.1)',
            marginBottom: '16px',
        });

        this._panels = document.createElement('div');
        this._opts = { activeBg, activeColor, inactiveColor, indicatorColor, radius, fontSize };
        this._tabs = [];
        this._activeIndex = -1;

        tabs.forEach((tab, i) => this._addTab(tab, i));

        this.el.appendChild(this._bar);
        this.el.appendChild(this._panels);
        this._attachToContainer();
        if (this._tabs.length) this.show(0);
        if (Object.keys(rest).length) this.props = rest;
    }

    _addTab({ label, content }, index) {
        const { activeColor, inactiveColor, indicatorColor, activeBg, radius, fontSize } = this._opts;
        const btn = document.createElement('button');
        btn.textContent = label;
        Object.assign(btn.style, {
            padding: '10px 18px', background: 'none',
            border: 'none', borderBottom: '2px solid transparent',
            marginBottom: '-1px', cursor: 'pointer',
            color: inactiveColor, fontSize, fontWeight: '500',
            transition: 'color 150ms, border-color 150ms',
            borderRadius: `${radius} ${radius} 0 0`,
        });
        btn.addEventListener('click', () => this.show(index));
        this._bar.appendChild(btn);

        const panel = document.createElement('div');
        panel.style.display = 'none';
        if (content instanceof BaseElement) panel.appendChild(content.el);
        else if (content instanceof HTMLElement) panel.appendChild(content);
        else if (typeof content === 'string') panel.textContent = content;
        this._panels.appendChild(panel);

        this._tabs.push({ btn, panel });
    }

    show(index) {
        const { activeColor, inactiveColor, indicatorColor, activeBg } = this._opts;
        this._tabs.forEach(({ btn, panel }, i) => {
            const active = i === index;
            panel.style.display = active ? '' : 'none';
            btn.style.color = active ? activeColor : inactiveColor;
            btn.style.borderBottomColor = active ? indicatorColor : 'transparent';
            btn.style.background = active ? activeBg : 'none';
        });
        this._activeIndex = index;
        return this;
    }

    addTab(tab) { this._addTab(tab, this._tabs.length); return this; }
    get active() { return this._activeIndex; }
}


export class Slider extends BaseElement {
    constructor(containerRef = null, props = {}) {
        const {
            min = 0, max = 100, value = 50, step = 1,
            trackColor = 'rgba(255,255,255,0.12)',
            fillColor = '#3b82f6', thumbColor = '#fff',
            height = 6, thumbSize = 18,
            ...rest
        } = props;

        super(containerRef);
        this._min = min; this._max = max;
        this._step = step; this._value = value;
        this._handlers = [];

        this.el = document.createElement('div');
        this.el.style.cssText = 'position:relative;width:100%;padding:8px 0;box-sizing:border-box;cursor:pointer';

        this._track = document.createElement('div');
        Object.assign(this._track.style, {
            position: 'relative', height: `${height}px`,
            background: trackColor, borderRadius: '999px',
        });

        this._fill = document.createElement('div');
        Object.assign(this._fill.style, {
            position: 'absolute', top: '0', left: '0',
            height: '100%', background: fillColor,
            borderRadius: '999px', pointerEvents: 'none', width: '0%',
        });

        this._thumb = document.createElement('div');
        Object.assign(this._thumb.style, {
            position: 'absolute', top: '50%',
            width: `${thumbSize}px`, height: `${thumbSize}px`,
            background: thumbColor, borderRadius: '50%',
            transform: 'translate(-50%, -50%)',
            boxShadow: '0 1px 6px rgba(0,0,0,0.4)',
            transition: 'box-shadow 150ms', userSelect: 'none',
        });

        this._track.appendChild(this._fill);
        this._track.appendChild(this._thumb);
        this.el.appendChild(this._track);

        this._setupDrag();
        this._attachToContainer();
        this._renderFill();
        if (Object.keys(rest).length) this.props = rest;
        this.set(value);
    }

    _pct() { return (this._value - this._min) / (this._max - this._min); }

    _renderFill() {
        const pct = this._pct() * 100;
        this._fill.style.width = `${pct}%`;
        this._thumb.style.left = `${pct}%`;
    }

    _calcValue(clientX) {
        const rect = this._track.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        const raw = this._min + pct * (this._max - this._min);
        const stepped = Math.round(raw / this._step) * this._step;
        return Math.max(this._min, Math.min(this._max, stepped));
    }

    _setupDrag() {
        let dragging = false;
        const update = clientX => {
            this._value = this._calcValue(clientX);
            this._renderFill();
            this._handlers.forEach(fn => fn(this._value));
        };
        const onMove  = e => { if (dragging) update(e.clientX); };
        const onTMove = e => { if (dragging) update(e.touches[0].clientX); };
        const onUp    = () => { dragging = false; };
        this._track.addEventListener('mousedown', e => { dragging = true; update(e.clientX); });
        this._track.addEventListener('touchstart', e => { dragging = true; update(e.touches[0].clientX); }, { passive: true });
        window.addEventListener('mousemove',  onMove);
        window.addEventListener('touchmove',  onTMove, { passive: true });
        window.addEventListener('mouseup',    onUp);
        window.addEventListener('touchend',   onUp);
        this.onDestroy(() => {
            window.removeEventListener('mousemove',  onMove);
            window.removeEventListener('touchmove',  onTMove);
            window.removeEventListener('mouseup',    onUp);
            window.removeEventListener('touchend',   onUp);
        });
    }

    get()  { return this._value; }
    set(v) { this._value = Math.max(this._min, Math.min(this._max, v)); this._renderFill(); return this; }
    onChange(fn) { this._handlers.push(fn); return this; }

    get value()  { return this._value; }
    set value(v) { this.set(v); }
    get min()    { return this._min; }
    set min(v)   { this._min = v; this._renderFill(); }
    get max()    { return this._max; }
    set max(v)   { this._max = v; this._renderFill(); }
}


export class ProgressBar extends BaseElement {
    constructor(containerRef = null, props = {}) {
        const {
            value = 0,
            trackColor = 'rgba(255,255,255,0.1)',
            fillColor = '#3b82f6',
            height = 8, radius = 999, animated = true, striped = false,
            ...rest
        } = props;

        super(containerRef);
        this.el = document.createElement('div');
        Object.assign(this.el.style, {
            width: '100%', height: `${height}px`,
            background: trackColor, borderRadius: `${radius}px`, overflow: 'hidden',
        });

        this._fill = document.createElement('div');
        Object.assign(this._fill.style, {
            height: '100%', background: fillColor,
            borderRadius: `${radius}px`, width: '0%',
            transition: animated ? 'width 400ms cubic-bezier(0.4,0,0.2,1)' : 'none',
        });

        if (striped) {
            this._fill.style.backgroundImage =
                `repeating-linear-gradient(45deg,transparent,transparent 10px,rgba(255,255,255,0.15) 10px,rgba(255,255,255,0.15) 20px)`;
        }

        this.el.appendChild(this._fill);
        this._value = 0;
        this._attachToContainer();
        if (Object.keys(rest).length) this.props = rest;
        this.set(value);
    }

    set(n)   { this._value = Math.max(0, Math.min(100, n)); this._fill.style.width = `${this._value}%`; return this; }
    get()    { return this._value; }
    get value()  { return this._value; }
    set value(v) { this.set(v); }
}


export class Toggle extends BaseElement {
    constructor(containerRef = null, props = {}) {
        const {
            checked = false,
            trackColor = 'rgba(255,255,255,0.15)',
            activeColor = '#3b82f6',
            thumbColor = '#fff',
            size = 1,
            onChange: onChangeProp = null,
            ...rest
        } = props;

        super(containerRef);
        const w = Math.round(44 * size), h = Math.round(24 * size);
        const thumbSz = Math.round(20 * size), offset = Math.round(2 * size);
        this._travel = w - thumbSz - offset * 2;
        this._trackColor = trackColor;
        this._activeColor = activeColor;
        this._checked = false;
        this._handlers = [];

        this.el = document.createElement('div');
        Object.assign(this.el.style, {
            display: 'inline-flex', alignItems: 'center',
            cursor: 'pointer', userSelect: 'none',
        });

        this._track = document.createElement('div');
        Object.assign(this._track.style, {
            width: `${w}px`, height: `${h}px`,
            borderRadius: '999px', position: 'relative',
            transition: 'background 200ms', background: trackColor, flexShrink: '0',
        });

        this._thumb = document.createElement('div');
        Object.assign(this._thumb.style, {
            position: 'absolute', top: `${offset}px`, left: `${offset}px`,
            width: `${thumbSz}px`, height: `${thumbSz}px`, borderRadius: '50%',
            background: thumbColor,
            transition: 'transform 200ms cubic-bezier(0.4,0,0.2,1)',
            boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
        });

        this._track.appendChild(this._thumb);
        this.el.appendChild(this._track);
        if (onChangeProp) this._handlers.push(onChangeProp);
        this.el.addEventListener('click', () => this.set(!this._checked));
        this._attachToContainer();
        if (Object.keys(rest).length) this.props = rest;
        this.set(checked);
    }

    set(val) {
        this._checked = val;
        this._track.style.background = val ? this._activeColor : this._trackColor;
        this._thumb.style.transform = val ? `translateX(${this._travel}px)` : 'translateX(0)';
        this._handlers.forEach(fn => fn(val));
        return this;
    }

    get()    { return this._checked; }
    onChange(fn) { this._handlers.push(fn); return this; }
    get checked()  { return this._checked; }
    set checked(v) { this.set(v); }
}


export class Accordion extends BaseElement {
    constructor(containerRef = null, props = {}) {
        const {
            items = [],
            headerBg = '#1e1e2e', headerColor = '#fff', headerHoverBg = '#2d2d3e',
            bodyBg = '#16162a', bodyColor = 'rgba(255,255,255,0.75)',
            radius = '8px', border = '1px solid rgba(255,255,255,0.08)',
            multi = false, gap = '8px', fontSize = '14px',
            ...rest
        } = props;

        super(containerRef);
        this.el = document.createElement('div');
        Object.assign(this.el.style, { display: 'flex', flexDirection: 'column', gap });

        this._opts = { headerBg, headerColor, headerHoverBg, bodyBg, bodyColor, radius, border, fontSize };
        this._multi = multi;
        this._items = [];

        items.forEach(item => this.addItem(item));
        this._attachToContainer();
        if (Object.keys(rest).length) this.props = rest;
    }

    addItem({ title, content, open: startOpen = false }) {
        const { headerBg, headerColor, headerHoverBg, bodyBg, bodyColor, radius, border, fontSize } = this._opts;

        const wrapper = document.createElement('div');
        Object.assign(wrapper.style, { border, borderRadius: radius, overflow: 'hidden' });

        const header = document.createElement('div');
        Object.assign(header.style, {
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '14px 18px', background: headerBg, color: headerColor,
            cursor: 'pointer', fontSize, fontWeight: '600',
            userSelect: 'none', transition: 'background 150ms',
        });

        const titleEl = document.createElement('span');
        titleEl.textContent = title;

        const icon = document.createElement('span');
        icon.textContent = '›';
        Object.assign(icon.style, {
            fontSize: '18px', display: 'inline-block',
            transition: 'transform 250ms cubic-bezier(0.4,0,0.2,1)',
        });

        header.appendChild(titleEl);
        header.appendChild(icon);

        const body = document.createElement('div');
        Object.assign(body.style, {
            background: bodyBg, color: bodyColor, fontSize,
            lineHeight: '1.65', maxHeight: '0', overflow: 'hidden',
            transition: 'max-height 300ms cubic-bezier(0.4,0,0.2,1), padding 300ms',
            padding: '0 18px',
        });

        if (typeof content === 'string') body.textContent = content;
        else if (content instanceof BaseElement) body.appendChild(content.el);
        else if (content instanceof HTMLElement) body.appendChild(content);

        let isOpen = false;

        const expand = () => {
            isOpen = true;
            body.style.maxHeight = body.scrollHeight + 'px';
            body.style.padding = '14px 18px';
            icon.style.transform = 'rotate(90deg)';
            header.style.background = headerHoverBg;
            const onEnd = e => {
                if (e.propertyName === 'max-height' && isOpen) body.style.maxHeight = 'none';
                body.removeEventListener('transitionend', onEnd);
            };
            body.addEventListener('transitionend', onEnd);
        };

        const close = () => {
            // Pin to current height first so the transition has a value to animate from
            body.style.maxHeight = body.scrollHeight + 'px';
            void body.offsetHeight; // force reflow
            isOpen = false;
            body.style.maxHeight = '0';
            body.style.padding = '0 18px';
            icon.style.transform = 'rotate(0deg)';
            header.style.background = headerBg;
        };

        header.addEventListener('mouseenter', () => { if (!isOpen) header.style.background = headerHoverBg; });
        header.addEventListener('mouseleave', () => { if (!isOpen) header.style.background = headerBg; });
        header.addEventListener('click', () => {
            if (!this._multi && !isOpen) this._items.forEach(it => { if (it.isOpen) it.close(); });
            isOpen ? close() : expand();
        });

        wrapper.appendChild(header);
        wrapper.appendChild(body);
        this.el.appendChild(wrapper);

        const entry = { get isOpen() { return isOpen; }, expand, close };
        this._items.push(entry);
        if (startOpen) expand();
        return this;
    }
}


export class Drawer extends BaseElement {
    constructor(containerRef = null, props = {}) {
        const {
            side = 'left', size = '280px',
            bg = '#1a1a2e', overlayColor = 'rgba(0,0,0,0.6)',
            shadow = null, content = null, onClose = null,
            closeOnOverlay = true, radius = '0',
            ...rest
        } = props;

        super(null);
        this._onClose = onClose;
        this._side = side;

        this.el = document.createElement('div');
        Object.assign(this.el.style, { position: 'fixed', inset: '0', zIndex: '9999', display: 'none' });

        this._overlay = document.createElement('div');
        Object.assign(this._overlay.style, {
            position: 'absolute', inset: '0',
            background: overlayColor, opacity: '0', transition: 'opacity 300ms',
        });

        const defaultShadows = {
            left: '4px 0 24px rgba(0,0,0,0.4)',   right: '-4px 0 24px rgba(0,0,0,0.4)',
            top:  '0 4px 24px rgba(0,0,0,0.4)',   bottom: '0 -4px 24px rgba(0,0,0,0.4)',
        };

        this._panel = document.createElement('div');
        const panelStyles = {
            position: 'absolute', background: bg,
            boxShadow: shadow || defaultShadows[side],
            overflowY: 'auto', borderRadius: radius,
            transition: 'transform 300ms cubic-bezier(0.4,0,0.2,1)',
        };
        if (side === 'left')   Object.assign(panelStyles, { top:'0', left:'0', bottom:'0', width: size, transform: 'translateX(-100%)' });
        if (side === 'right')  Object.assign(panelStyles, { top:'0', right:'0', bottom:'0', width: size, transform: 'translateX(100%)' });
        if (side === 'top')    Object.assign(panelStyles, { top:'0', left:'0', right:'0', height: size, transform: 'translateY(-100%)' });
        if (side === 'bottom') Object.assign(panelStyles, { bottom:'0', left:'0', right:'0', height: size, transform: 'translateY(100%)' });
        Object.assign(this._panel.style, panelStyles);

        if (content instanceof BaseElement) this._panel.appendChild(content.el);
        else if (content instanceof HTMLElement) this._panel.appendChild(content);

        if (closeOnOverlay) this._overlay.addEventListener('click', () => this.close());

        this.el.appendChild(this._overlay);
        this.el.appendChild(this._panel);
        document.body.appendChild(this.el);
        this._triggerMount();
        if (Object.keys(rest).length) this.props = rest;
    }

    open() {
        this.el.style.display = 'block';
        requestAnimationFrame(() => requestAnimationFrame(() => {
            this._overlay.style.opacity = '1';
            this._panel.style.transform = 'translate(0,0)';
        }));
        return this;
    }

    close() {
        this._overlay.style.opacity = '0';
        const s = this._side;
        this._panel.style.transform =
            s === 'left'   ? 'translateX(-100%)' :
            s === 'right'  ? 'translateX(100%)'  :
            s === 'top'    ? 'translateY(-100%)' : 'translateY(100%)';
        setTimeout(() => { this.el.style.display = 'none'; if (this._onClose) this._onClose(); }, 300);
        return this;
    }

    setContent(content) {
        this._panel.innerHTML = '';
        if (content instanceof BaseElement) this._panel.appendChild(content.el);
        else if (content instanceof HTMLElement) this._panel.appendChild(content);
        else if (typeof content === 'string') this._panel.innerHTML = content;
        return this;
    }
}


export class Chip extends BaseElement {
    constructor(containerRef = null, props = {}) {
        const {
            text = '', bg = 'rgba(59,130,246,0.2)', color = '#93c5fd',
            radius = '999px', fontSize = '12px', padding = '4px 10px',
            border = '1px solid rgba(59,130,246,0.3)',
            onRemove = null, removable = !!onRemove,
            ...rest
        } = props;

        super(containerRef);
        this.el = document.createElement('div');
        Object.assign(this.el.style, {
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            background: bg, color, borderRadius: radius,
            fontSize, padding, border, userSelect: 'none', lineHeight: '1.4',
        });

        this._label = document.createElement('span');
        this._label.textContent = text;
        this.el.appendChild(this._label);

        if (removable || onRemove) {
            const x = document.createElement('span');
            x.textContent = '×';
            Object.assign(x.style, {
                cursor: 'pointer', fontSize: '15px', lineHeight: '1',
                opacity: '0.6', transition: 'opacity 120ms',
            });
            x.addEventListener('mouseenter', () => { x.style.opacity = '1'; });
            x.addEventListener('mouseleave', () => { x.style.opacity = '0.6'; });
            x.addEventListener('click', e => {
                e.stopPropagation();
                if (onRemove) onRemove(this); else this.destroy();
            });
            this.el.appendChild(x);
        }

        this._attachToContainer();
        if (Object.keys(rest).length) this.props = rest;
    }

    set text(v) { this._label.textContent = v; }
    get text()  { return this._label.textContent; }
}


export class Card extends BaseElement {
    constructor(containerRef = null, props = {}) {
        const {
            title = '', content = null, footer = null,
            bg = '#1a1a2e', radius = '12px',
            shadow = '0 4px 24px rgba(0,0,0,0.3)',
            border = '1px solid rgba(255,255,255,0.08)',
            padding = '20px', titleColor = '#fff', titleSize = '16px',
            contentColor = 'rgba(255,255,255,0.75)',
            ...rest
        } = props;

        super(containerRef);
        this.el = document.createElement('div');
        Object.assign(this.el.style, {
            background: bg, borderRadius: radius,
            boxShadow: shadow, border, overflow: 'hidden',
        });

        if (title) {
            this._headerEl = document.createElement('div');
            Object.assign(this._headerEl.style, {
                padding, borderBottom: '1px solid rgba(255,255,255,0.07)',
                color: titleColor, fontSize: titleSize, fontWeight: '700',
            });
            this._headerEl.textContent = title;
            this.el.appendChild(this._headerEl);
        }

        this._bodyEl = document.createElement('div');
        Object.assign(this._bodyEl.style, { padding, color: contentColor, fontSize: '14px', lineHeight: '1.65' });
        this._setSlot(this._bodyEl, content);
        this.el.appendChild(this._bodyEl);

        if (footer !== null) {
            this._footerEl = document.createElement('div');
            Object.assign(this._footerEl.style, {
                padding, borderTop: '1px solid rgba(255,255,255,0.07)',
                color: contentColor, fontSize: '13px',
            });
            this._setSlot(this._footerEl, footer);
            this.el.appendChild(this._footerEl);
        }

        this._attachToContainer();
        if (Object.keys(rest).length) this.props = rest;
    }

    _setSlot(el, content) {
        if (typeof content === 'string') el.textContent = content;
        else if (content instanceof BaseElement) el.appendChild(content.el);
        else if (content instanceof HTMLElement) el.appendChild(content);
    }

    set title(v) { if (this._headerEl) this._headerEl.textContent = v; }
    get title()  { return this._headerEl?.textContent ?? ''; }
    setContent(v) { this._bodyEl.innerHTML = ''; this._setSlot(this._bodyEl, v); return this; }
    get body() { return this._bodyEl; }
}


// ──────────────────────────────────────────────────────
// §19  PLUGIN SYSTEM  (defined after §14 ctrlscript ref)
//      csui.use({ name, install({ BaseElement, register, addProto }) })
// ──────────────────────────────────────────────────────
// (use() is attached to csui after §14 is defined — see below)


// ──────────────────────────────────────────────────────
// §20  GLASSMORPHISM
//      el.glass()          — lazy (semi-transparent bg)
//      el.glass({ pro:true }) — professional (backdrop blur)
// ──────────────────────────────────────────────────────
BaseElement.prototype.glass = function({
    pro = false,
    blur = 12,
    bg = null,
    opacity = 0.12,
    border = true,
    borderColor = 'rgba(255,255,255,0.18)',
    shadow = true,
    shadowColor = 'rgba(0,0,0,0.25)',
    saturation = 1.8,
} = {}) {
    const finalBg = bg || `rgba(255,255,255,${opacity})`;
    if (pro) {
        Object.assign(this.el.style, {
            background: finalBg,
            backdropFilter: `blur(${blur}px) saturate(${Math.round(saturation * 100)}%)`,
            WebkitBackdropFilter: `blur(${blur}px) saturate(${Math.round(saturation * 100)}%)`,
            ...(border && { border: `1px solid ${borderColor}` }),
            ...(shadow && { boxShadow: `0 8px 32px 0 ${shadowColor}` }),
        });
    } else {
        Object.assign(this.el.style, {
            background: finalBg,
            ...(border && { border: `1px solid ${borderColor}` }),
        });
    }
    return this;
};


// ──────────────────────────────────────────────────────
// §20b  PROTOTYPE HELPERS — tooltip · badge · contextMenu
// ──────────────────────────────────────────────────────

BaseElement.prototype.tooltip = function(text, {
    pos = 'top', bg = 'rgba(0,0,0,0.85)', color = '#fff',
    fontSize = '12px', radius = '6px', delay = 0, padding = '6px 10px',
} = {}) {
    if (this._tooltipEl) this._tooltipEl.remove();
    const tip = document.createElement('div');
    this._tooltipEl = tip;
    tip.textContent = text;
    Object.assign(tip.style, {
        position: 'fixed', zIndex: '99998', background: bg, color,
        fontSize, borderRadius: radius, padding,
        pointerEvents: 'none', whiteSpace: 'nowrap',
        opacity: '0', transition: 'opacity 150ms', lineHeight: '1.4',
    });
    document.body.appendChild(tip);
    let _timer;

    this.el.addEventListener('mouseenter', () => {
        _timer = setTimeout(() => {
            const r = this.el.getBoundingClientRect();
            const tw = tip.offsetWidth, th = tip.offsetHeight, gap = 8;
            const positions = {
                top:    { left: r.left + r.width  / 2 - tw / 2, top: r.top  - th - gap },
                bottom: { left: r.left + r.width  / 2 - tw / 2, top: r.bottom + gap },
                left:   { left: r.left - tw - gap,               top: r.top  + r.height / 2 - th / 2 },
                right:  { left: r.right + gap,                   top: r.top  + r.height / 2 - th / 2 },
            };
            const p = positions[pos] || positions.top;
            tip.style.left = `${p.left}px`;
            tip.style.top  = `${p.top}px`;
            tip.style.opacity = '1';
        }, delay);
    });
    this.el.addEventListener('mouseleave', () => { clearTimeout(_timer); tip.style.opacity = '0'; });
    this.onDestroy(() => tip.remove());
    return this;
};


BaseElement.prototype.badge = function(count, {
    bg = '#ef4444', color = '#fff',
    size = 18, fontSize = '11px',
    offsetX = 0, offsetY = 0,
} = {}) {
    const computedDisplay = getComputedStyle(this.el).display;
    if (computedDisplay === 'inline') this.el.style.display = 'inline-flex';
    const pos = getComputedStyle(this.el).position;
    if (!pos || pos === 'static') this.el.style.position = 'relative';

    const existing = this.el.querySelector('._csuiBadge');
    if (existing) existing.remove();
    if (count === null || count === undefined || count === 0) return this;

    const b = document.createElement('div');
    b.className = '_csuiBadge';
    b.textContent = count > 99 ? '99+' : String(count);
    Object.assign(b.style, {
        position: 'absolute',
        top: `${-size / 2 + offsetY}px`,
        right: `${-size / 2 + offsetX}px`,
        minWidth: `${size}px`, height: `${size}px`,
        background: bg, color, borderRadius: '999px',
        fontSize, fontWeight: '700',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '0 4px', lineHeight: '1', boxSizing: 'border-box',
        pointerEvents: 'none',
    });
    this.el.appendChild(b);
    return this;
};


BaseElement.prototype.contextMenu = function(items, {
    bg = '#1e1e2e', itemColor = '#e0e0e0', itemHoverBg = '#2d2d3e',
    shadow = '0 8px 24px rgba(0,0,0,0.4)',
    radius = '8px', border = '1px solid rgba(255,255,255,0.08)',
    fontSize = '14px',
} = {}) {
    const menu = document.createElement('div');
    Object.assign(menu.style, {
        position: 'fixed', zIndex: '99997',
        background: bg, borderRadius: radius,
        boxShadow: shadow, border,
        overflow: 'hidden', display: 'none', minWidth: '160px',
    });

    items.forEach(item => {
        if (item.divider) {
            const d = document.createElement('div');
            d.style.cssText = 'height:1px;background:rgba(255,255,255,0.08);margin:4px 0';
            menu.appendChild(d);
            return;
        }
        const el = document.createElement('div');
        el.textContent = item.label;
        Object.assign(el.style, {
            padding: '10px 16px', cursor: 'pointer', color: itemColor,
            fontSize, userSelect: 'none', transition: 'background 100ms',
        });
        el.addEventListener('mouseenter', () => { el.style.background = itemHoverBg; });
        el.addEventListener('mouseleave', () => { el.style.background = ''; });
        el.addEventListener('click', () => { if (item.onClick) item.onClick(); menu.style.display = 'none'; });
        menu.appendChild(el);
    });

    document.body.appendChild(menu);

    this.el.addEventListener('contextmenu', e => {
        e.preventDefault();
        menu.style.left = `${e.clientX}px`;
        menu.style.top  = `${e.clientY}px`;
        menu.style.display = 'block';
        requestAnimationFrame(() => {
            const r = menu.getBoundingClientRect();
            if (r.right  > window.innerWidth)  menu.style.left = `${e.clientX - r.width}px`;
            if (r.bottom > window.innerHeight) menu.style.top  = `${e.clientY - r.height}px`;
        });
    });
    const _hideCtxMenu   = () => { menu.style.display = 'none'; };
    const _docCtxMenu    = e  => { if (!this.el.contains(e.target)) menu.style.display = 'none'; };
    document.addEventListener('click',       _hideCtxMenu);
    document.addEventListener('contextmenu', _docCtxMenu);
    this.onDestroy(() => {
        menu.remove();
        document.removeEventListener('click',       _hideCtxMenu);
        document.removeEventListener('contextmenu', _docCtxMenu);
    });
    return this;
};


// ──────────────────────────────────────────────────────
// §21  COLOR PALETTE GENERATOR
//      palette("#3b82f6")
//      palette("#3b82f6", { name:"brand", shades:[50,100,...,900] })
// ──────────────────────────────────────────────────────

function _rgbToHSL(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0, l = (max + min) / 2;
    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
            case g: h = ((b - r) / d + 2) / 6; break;
            case b: h = ((r - g) / d + 4) / 6; break;
        }
    }
    return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function _hslToHex(h, s, l) {
    s /= 100; l /= 100;
    const a = s * Math.min(l, 1 - l);
    const f = n => {
        const k = (n + h / 30) % 12;
        const c = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
        return Math.round(255 * c).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
}

function _colorToHSL(color) {
    if (!document.body) return null;
    const tmp = document.createElement('div');
    tmp.style.cssText = `color:${color};position:absolute;visibility:hidden;pointer-events:none`;
    document.body.appendChild(tmp);
    const computed = window.getComputedStyle(tmp).color;
    document.body.removeChild(tmp);
    const m = computed.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    return m ? _rgbToHSL(parseInt(m[1]), parseInt(m[2]), parseInt(m[3])) : null;
}

function _printPalette(name, result, shades) {
    const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
    console.group(`%c  🎨  ${cap(name)} Palette  `, 'font-weight:800;font-size:13px;background:#111;color:#fff;padding:4px 8px;border-radius:4px');
    shades.forEach(shade => {
        const hex = result[shade];
        const lum = parseInt(hex.slice(1, 3), 16) * 0.299 + parseInt(hex.slice(3, 5), 16) * 0.587 + parseInt(hex.slice(5, 7), 16) * 0.114;
        const fg = lum > 140 ? '#000' : '#fff';
        console.log(
            `%c  ${String(shade).padStart(3)}  %c  ${hex}  `,
            `background:${hex};color:${fg};font-weight:700;padding:4px 2px;font-size:12px;font-family:monospace`,
            `background:${hex};color:${fg};font-family:monospace;padding:4px 6px;font-size:12px`
        );
    });
    console.groupEnd();
    const cssVars = shades.map(s => `  --${name}-${s}: ${result[s]};`).join('\n');
    console.log('%c  Copy as CSS variables:', 'color:#7dd3fc;font-size:11px;font-weight:600');
    console.log(`%c:root {\n${cssVars}\n}`, 'color:#86efac;font-family:monospace;font-size:11px');
    const jsObj = `{\n${shades.map(s => `  ${s}: '${result[s]}'`).join(',\n')}\n}`;
    console.log('%c  Copy as JS object:', 'color:#7dd3fc;font-size:11px;font-weight:600');
    console.log(`%c${jsObj}`, 'color:#fde68a;font-family:monospace;font-size:11px');
}

export function palette(baseColor, {
    name = 'color',
    shades = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900],
    display = true,
} = {}) {
    const hsl = _colorToHSL(baseColor);
    if (!hsl) { console.error(`[csui] palette: cannot parse color "${baseColor}"`); return null; }
    const { h, s, l: baseL } = hsl;

    // Absolute lightness table anchored at 500 = L50 (mid-point of a neutral palette).
    // We shift the whole curve by (baseL - 50) so shade 500 always equals the input color.
    const baseLTable = { 50: 97, 100: 93, 200: 85, 300: 74, 400: 63, 500: 50, 600: 38, 700: 27, 800: 16, 900: 7 };
    // Saturation scale per shade (extremes are less saturated)
    const satScale   = { 50: 0.45, 100: 0.55, 200: 0.70, 300: 0.88, 400: 0.97, 500: 1.0, 600: 1.0, 700: 0.97, 800: 0.88, 900: 0.75 };

    const offset = baseL - 50;
    const result = {};
    for (const shade of shades) {
        const refL    = baseLTable[shade] ?? 50;
        const sf      = satScale[shade] ?? 1;
        const targetL = Math.max(3, Math.min(97, Math.round(refL + offset)));
        const targetS = Math.max(0, Math.min(100, Math.round(s * sf)));
        result[shade] = _hslToHex(h, targetS, targetL);
    }

    if (display) _printPalette(name, result, shades);
    return result;
}


// ──────────────────────────────────────────────────────
// §14  NAMESPACE EXPORTS
//
//  Option A — named imports (tree-shakeable):
//    import { Box, loop, save, sound } from './csui.js'
//
//  Option B — single namespace (easiest):
//    import { ctrlscript } from './csui.js'
//    const { Box, loop, sound } = ctrlscript
//
//  Option C — alias:
//    import { CS } from './csui.js'
//
//  Optional modules (same file, no extra download):
//    import { engine2d, sound, particles } from './csui.js'
// ──────────────────────────────────────────────────────
export const ctrlscript = {
    // ── Elements ──
    Box, App, Text, Label, Button, Input,
    Image, Rectangle, Square, Circle, Ellipse, Line,
    Heading, Paragraph, TextArea, Span, Link,
    Section, Article, Header, Footer, Nav,
    List, ListItem, Select, Checkbox, Radio,
    Canvas, Video, Audio, Iframe,
    Code, CodeBlock, Pre,
    Table, TableRow, TableCell,
    Form, HR, BR,
    Container, Div,

    // ── Layout ──
    group,

    // ── UI Components ──
    DropdownMenu, Modal, toast, Tabs, Slider, ProgressBar, Toggle,
    Accordion, Drawer, Chip, Card,

    // ── Game ──
    loop, onKey, collides, scene, go, camera,

    // ── Timers ──
    after, every,

    // ── Storage ──
    save, load,

    // ── Prompt ──
    ask,

    // ── Modules ──
    sound, particles, engine2d,

    // ── Navigation & Device ──
    router, device,

    // ── Palette ──
    palette,

    // ── Utils ──
    remove, clearContainers, getContainer, listContainers, checkOverlap,

    // ── SVG ──
    // (classes added via Object.assign below, after they are defined)

    // ── Dev ──
    csui,
};

// ──────────────────────────────────────────────────────
// §19  PLUGIN SYSTEM
//      csui.use({ name, install({ BaseElement, Box, register, addProto }) })
// ──────────────────────────────────────────────────────
const _plugins = new Map();

export function use(plugin) {
    if (!plugin || typeof plugin.name !== 'string' || typeof plugin.install !== 'function') {
        console.error('[csui] use() expects { name: string, install(api) {} }');
        return;
    }
    if (_plugins.has(plugin.name)) {
        console.warn(`[csui] Plugin "${plugin.name}" already registered — skipping`);
        return;
    }
    plugin.install({
        BaseElement,
        Box,
        containers,
        containersByName,
        register(name, Cls) { ctrlscript[name] = Cls; },
        addProto(Target, name, fn) { Target.prototype[name] = fn; },
    });
    _plugins.set(plugin.name, plugin);
}

// Attach use() to csui object so both csui.use() and import { use } work
csui.use = use;
ctrlscript.use = use;

// Short alias
export { ctrlscript as CS };

// ── §21 — Android Compatibility Layer ────────────────────────────────────────
// Stubs so the same app.js runs in both csui (browser) and csua (Android).
// Android-only APIs fall back to browser equivalents or log a warning.

const _noop    = () => {};
const _warn    = (api) => { console.warn(`[csui] '${api}' is Android-only — no-op in browser.`); };
const _promise = (api, val = null) => { _warn(api); return Promise.resolve(val); };

// Missing element classes
export class ScrollBox extends Box {
    constructor(ref, props = {}) { super(ref, { overflow: 'auto', ...props }); }
}
class _CompatTextArea extends Input {
    constructor(ref, props = {}) {
        super(ref, props);
        const ta = document.createElement('textarea');
        ta.style.cssText = this.el.style.cssText;
        this.el.replaceWith(ta);
        this.el = ta;
        if (props.text) ta.value = props.text;
    }
    get text()    { return this.el.value; }
    set text(v)   { this.el.value = v; }
}
class _CompatRectangle extends Box {
    constructor(ref, props = {}) { super(ref, props); }
}
const _CompatSquare = _CompatRectangle;
class _CompatCircle extends Box {
    constructor(ref, props = {}) { super(ref, { br: '50%', ...props }); }
}
export class SafeArea extends Box {
    constructor(ref, props = {}) {
        super(ref, props);
        this.el.style.paddingTop    = 'env(safe-area-inset-top, 0px)';
        this.el.style.paddingBottom = 'env(safe-area-inset-bottom, 0px)';
    }
}
class _CompatList extends Box {
    constructor(ref, props = {}) {
        super(ref, props);
        this._itemMap = new Map(); // key -> { el, data }
    }
    setItems(items, renderFn) {
        const prev = this._itemMap;
        const next = new Map();
        const frag = document.createDocumentFragment();

        items.forEach((item, i) => {
            const key = item && item.key != null ? String(item.key) : `__idx${i}`;
            const existing = prev.get(key);
            if (existing) {
                renderFn(item, existing.el);
                next.set(key, existing);
            } else {
                const wrapper = document.createElement('div');
                renderFn(item, wrapper);
                next.set(key, { el: wrapper, data: item });
                frag.appendChild(wrapper);
            }
        });

        // Remove items no longer in the list
        for (const [key, entry] of prev) {
            if (!next.has(key)) entry.el.remove();
        }

        this.el.appendChild(frag);
        this._itemMap = next;
    }
}

// Timers — align with csua names
export function stopLoop(fn) {
    // csui loop() returns a cancel handle; stopLoop mirrors csua's API
    _warn('stopLoop — use the return value of loop() in csui');
}
export function cancel(id) { clearTimeout(id); clearInterval(id); }
export function clearAll() { localStorage.clear(); }

// db — localStorage-backed IndexedDB-style shim
export const db = {
    run(sql, ...args)    { _warn('db.run'); return Promise.resolve(); },
    query(sql, ...args)  { _warn('db.query'); return Promise.resolve([]); },
    get(sql, ...args)    { _warn('db.get'); return Promise.resolve(null); },
};

// files — no file system in browser
export const files = {
    read(path)         { return _promise('files.read'); },
    write(path, data)  { return _promise('files.write'); },
    delete(path)       { return _promise('files.delete'); },
    exists(path)       { return _promise('files.exists', false); },
    list(dir)          { return _promise('files.list', []); },
};

// perm — browser Permissions API where possible
export const perm = {
    request(...perms) {
        const browserMap = { camera: 'camera', microphone: 'microphone', location: 'geolocation' };
        const p = perms[0];
        if (browserMap[p] && navigator.permissions) {
            return navigator.permissions.query({ name: browserMap[p] })
                .then(r => r.state === 'granted');
        }
        return Promise.resolve(true);
    },
    check(p) { return this.request(p); },
};
export const permission  = perm;
export const permissions = perm;

// Sound class — wraps browser Audio
export class Sound {
    constructor(src) { this._a = new Audio(src); }
    play()           { this._a.play(); }
    pause()          { this._a.pause(); }
    stop()           { this._a.pause(); this._a.currentTime = 0; }
    set volume(v)    { this._a.volume = v; }
    set loop(v)      { this._a.loop = v; }
}

// app — lifecycle shims
export const app = {
    onPause(fn)   { window.addEventListener('blur',  fn); },
    onResume(fn)  { window.addEventListener('focus', fn); },
    onDestroy(fn) { window.addEventListener('beforeunload', fn); },
    onBack(fn)    { window.addEventListener('popstate', fn); },
    version()     { return '1.0.0'; },
    clearRoot()   { document.body.innerHTML = ''; },
    requestFrame(fn) { requestAnimationFrame(fn); },
};

// keyboard — virtual keyboard stub (desktop always shows physical keyboard)
export const keyboard = {
    show()  { _warn('keyboard.show'); },
    hide()  { _warn('keyboard.hide'); },
    onShow(fn) { _warn('keyboard.onShow'); },
    onHide(fn) { _warn('keyboard.onHide'); },
};

// statusBar / navigationBar — no equivalent in browser
export const statusBar = {
    color(c)   { _warn('statusBar.color'); },
    light()    { _warn('statusBar.light'); },
    dark()     { _warn('statusBar.dark'); },
    hide()     { _warn('statusBar.hide'); },
    show()     { _warn('statusBar.show'); },
};
export const navigationBar = {
    color(c)  { _warn('navigationBar.color'); },
    hide()    { _warn('navigationBar.hide'); },
    show()    { _warn('navigationBar.show'); },
};

// share — Web Share API with fallback
export function share({ text = '', title = '', url = '' } = {}) {
    if (navigator.share) return navigator.share({ title, text, url });
    prompt('Copy to share:', `${title}\n${text}\n${url}`);
    return Promise.resolve();
}
export function openUrl(url)         { window.open(url, '_blank'); }
export function openApp(pkg)         { _warn('openApp'); }
export function openSettings()       { _warn('openSettings'); }
export function openMaps({ lat, lng, label = '' } = {}) {
    window.open(`https://maps.google.com/?q=${lat},${lng}`, '_blank');
}

// dialog — browser native
export const dialog = {
    alert(msg)                { return new Promise(r => { alert(msg); r(); }); },
    confirm(msg)              { return new Promise(r => r(window.confirm(msg))); },
    prompt(msg, def = '')     { return new Promise(r => r(window.prompt(msg, def))); },
    datePicker(opts = {})     { return _promise('dialog.datePicker'); },
    timePicker(opts = {})     { return _promise('dialog.timePicker'); },
};

// background — stub (Service Worker could work but out of scope)
export const background = {
    schedule(fn, opts = {})   { _warn('background.schedule'); },
    cancel(id)                { _warn('background.cancel'); },
};

// animate — CSS transition helper
export function animate(element, props = {}, { duration = 300, easing = 'ease', delay = 0 } = {}) {
    const el = element.el || element;
    el.style.transition = `all ${duration}ms ${easing} ${delay}ms`;
    Object.entries(props).forEach(([k, v]) => { el.style[k] = v; });
    return new Promise(r => setTimeout(r, duration + delay));
}

// onTouch / onSwipe / onPinch — mouse + touch events
export function onTouch(element, fn) {
    const el = element.el || element;
    const handle = e => {
        const t = e.touches ? e.touches[0] : e;
        fn({ x: t.clientX, y: t.clientY, type: e.type });
    };
    el.addEventListener('mousedown', handle);
    el.addEventListener('touchstart', handle, { passive: true });
}
export function onSwipe(element, fn) {
    const el = element.el || element;
    let sx, sy;
    el.addEventListener('touchstart', e => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
    el.addEventListener('touchend', e => {
        const dx = e.changedTouches[0].clientX - sx;
        const dy = e.changedTouches[0].clientY - sy;
        const dir = Math.abs(dx) > Math.abs(dy)
            ? (dx > 0 ? 'right' : 'left')
            : (dy > 0 ? 'down'  : 'up');
        fn({ direction: dir, dx, dy });
    }, { passive: true });
}
export function onPinch(element, fn) {
    const el = element.el || element;
    let lastDist = 0;
    el.addEventListener('touchmove', e => {
        if (e.touches.length < 2) return;
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        fn({ scale: dist / (lastDist || dist), distance: dist });
        lastDist = dist;
    }, { passive: true });
}

// ──────────────────────────────────────────────────────
// §SVG — Vector Graphics (browser)
//   Svg is a BaseElement wrapping a native <svg> element.
//   SvgShape / SvgGroup are thin DOM wrappers — NOT BaseElements.
//   Changes are live (no render() needed).
//   API is identical to csua.js (Android).
// ──────────────────────────────────────────────────────

const _SVG_NS = 'http://www.w3.org/2000/svg';

function _svgAttr(k) { return k.replace(/([A-Z])/g, m => '-' + m.toLowerCase()); }

class _SvgShapeBase {
    constructor(parent, tag, attrs = {}) {
        this.el = document.createElementNS(_SVG_NS, tag);
        const { text, ...rest } = attrs;
        for (const [k, v] of Object.entries(rest))
            if (v != null) this.el.setAttribute(_svgAttr(k), String(v));
        if (text !== undefined) this.el.textContent = text;
        (parent.el || parent).appendChild(this.el);
    }
    set(attrs) {
        const { text, ...rest } = attrs;
        for (const [k, v] of Object.entries(rest))
            if (v != null) this.el.setAttribute(_svgAttr(k), String(v));
        if (text !== undefined) this.el.textContent = text;
        return this;
    }
    remove() { this.el.parentNode?.removeChild(this.el); }
}

export class SvgGroup {
    constructor(parent, attrs = {}) {
        this.el = document.createElementNS(_SVG_NS, 'g');
        for (const [k, v] of Object.entries(attrs))
            if (v != null) this.el.setAttribute(_svgAttr(k), String(v));
        (parent.el || parent).appendChild(this.el);
    }
    set(attrs) {
        for (const [k, v] of Object.entries(attrs))
            if (v != null) this.el.setAttribute(_svgAttr(k), String(v));
        return this;
    }
}

export class Svg extends BaseElement {
    constructor(containerIndex = null, props = {}) {
        super(containerIndex);
        const { w = 300, h = 200, bg, viewBox, ...rest } = props;
        this.el = document.createElementNS(_SVG_NS, 'svg');
        this.el.setAttribute('xmlns', _SVG_NS);
        this.el.setAttribute('width',  typeof w === 'number' ? w + 'px' : w);
        this.el.setAttribute('height', typeof h === 'number' ? h + 'px' : h);
        this.el.setAttribute('viewBox', viewBox || `0 0 ${+w || w} ${+h || h}`);
        if (bg) this.el.style.background = bg;
        this.el.style.display = 'block';
        this._attachToContainer();
        if (Object.keys(rest).length) this.props = rest;
    }
    render() {}  // live DOM — no-op, exists for API compatibility with csua.js
    clear()  { while (this.el.firstChild) this.el.removeChild(this.el.firstChild); }
}

export class SvgRect     extends _SvgShapeBase { constructor(p, a = {}) { super(p, 'rect',     a); } }
export class SvgCircle   extends _SvgShapeBase { constructor(p, a = {}) { super(p, 'circle',   a); } }
export class SvgEllipse  extends _SvgShapeBase { constructor(p, a = {}) { super(p, 'ellipse',  a); } }
export class SvgLine     extends _SvgShapeBase { constructor(p, a = {}) { super(p, 'line',     a); } }
export class SvgPath     extends _SvgShapeBase { constructor(p, a = {}) { super(p, 'path',     a); } }
export class SvgPolygon  extends _SvgShapeBase { constructor(p, a = {}) { super(p, 'polygon',  a); } }
export class SvgPolyline extends _SvgShapeBase { constructor(p, a = {}) { super(p, 'polyline', a); } }
export class SvgText     extends _SvgShapeBase { constructor(p, a = {}) { super(p, 'text',     a); } }


// Extend ctrlscript namespace with new exports
Object.assign(ctrlscript, {
    ScrollBox, TextArea: _CompatTextArea, Rectangle: _CompatRectangle, Square: _CompatSquare, Circle: _CompatCircle, SafeArea, List: _CompatList,
    stopLoop, cancel, clearAll, db, files,
    perm, permission, permissions, Sound,
    app, keyboard, statusBar, navigationBar,
    share, openUrl, openApp, openSettings, openMaps,
    dialog, background, animate, onTouch, onSwipe, onPinch,
    Svg, SvgGroup,
    SvgRect, SvgCircle, SvgEllipse, SvgLine,
    SvgPath, SvgPolygon, SvgPolyline, SvgText,
});

// ── Expose everything as globals so app.js needs zero imports ──
// Works whether csui.js is loaded as <script type="module"> or plain <script>.
if (typeof globalThis !== 'undefined') {
    Object.assign(globalThis, ctrlscript);
    globalThis.ctrlscript = ctrlscript;
    globalThis.CS = ctrlscript;
}
