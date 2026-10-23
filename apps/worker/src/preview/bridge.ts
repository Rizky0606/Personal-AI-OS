/**
 * Skrip yang disisipkan proxy ke halaman preview. Berjalan di dalam iframe aplikasi desktop dan hanya bicara
 * lewat postMessage ke jendela induk: meneruskan console dan error halaman, serta mode inspeksi elemen.
 * Ditulis sebagai JavaScript biasa tanpa backtick dan `${`, karena disimpan sebagai string.
 */
export const BRIDGE_PATH = '/__aios_bridge.js';

export const BRIDGE_SOURCE = String.raw`(function () {
  if (window.__aiosBridge) return;
  window.__aiosBridge = true;
  var parentWin = window.parent;
  if (!parentWin || parentWin === window) return;
  var MAX_TEXT = 2000;
  var MAX_HTML = 4000;

  function post(message) {
    try {
      message.aios = 'preview';
      parentWin.postMessage(message, '*');
    } catch (e) {}
  }

  function show(value) {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return value.stack || value.message;
    try { return JSON.stringify(value); } catch (e) { return String(value); }
  }

  function clip(text, max) {
    return text.length > max ? text.slice(0, max) + '…' : text;
  }

  ['log', 'info', 'warn', 'error', 'debug'].forEach(function (level) {
    var original = console[level];
    console[level] = function () {
      try {
        post({ type: 'console', level: level, text: clip(Array.prototype.map.call(arguments, show).join(' '), MAX_TEXT) });
      } catch (e) {}
      return original.apply(console, arguments);
    };
  });

  window.addEventListener('error', function (event) {
    var target = event.target;
    if (target && target !== window && (target.src || target.href)) {
      post({ type: 'console', level: 'error', text: 'Gagal memuat ' + (target.src || target.href) });
      return;
    }
    post({
      type: 'console',
      level: 'error',
      text: clip((event.message || 'Error') + (event.filename ? ' (' + event.filename + ':' + event.lineno + ')' : ''), MAX_TEXT)
    });
  }, true);

  window.addEventListener('unhandledrejection', function (event) {
    post({ type: 'console', level: 'error', text: 'Promise ditolak: ' + clip(show(event.reason), MAX_TEXT) });
  });

  var nativeFetch = window.fetch;
  if (nativeFetch) {
    window.fetch = function () {
      var input = arguments[0];
      var url = typeof input === 'string' ? input : input && input.url;
      return nativeFetch.apply(this, arguments).then(function (response) {
        if (!response.ok) post({ type: 'console', level: 'error', text: 'Request ' + response.status + ': ' + url });
        return response;
      }, function (error) {
        post({ type: 'console', level: 'error', text: 'Request gagal: ' + url + ' (' + show(error) + ')' });
        throw error;
      });
    };
  }

  /* Mode inspeksi: sorot elemen di bawah kursor, klik memilihnya. */
  var inspecting = false;
  var box = null;

  function ensureBox() {
    if (box) return box;
    box = document.createElement('div');
    box.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;outline:2px solid Highlight;background:rgba(127,127,127,0.15);display:none';
    document.documentElement.appendChild(box);
    return box;
  }

  function selectorOf(el) {
    var parts = [];
    var node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement && parts.length < 6) {
      if (node.id && /^[A-Za-z][\w-]*$/.test(node.id)) {
        parts.unshift('#' + node.id);
        break;
      }
      var part = node.tagName.toLowerCase();
      var classes = (node.getAttribute('class') || '').split(/\s+/).filter(function (c) { return /^[A-Za-z_][\w-]*$/.test(c); }).slice(0, 2);
      if (classes.length) part += '.' + classes.join('.');
      var parent = node.parentElement;
      if (parent) {
        var same = Array.prototype.filter.call(parent.children, function (c) { return c.tagName === node.tagName; });
        if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(node) + 1) + ')';
      }
      parts.unshift(part);
      node = parent;
    }
    return parts.join(' > ');
  }

  var STYLE_PROPS = ['display', 'position', 'width', 'height', 'margin', 'padding', 'color', 'background-color', 'font-family', 'font-size', 'font-weight', 'line-height', 'overflow', 'text-overflow', 'white-space', 'flex', 'grid-template-columns', 'gap', 'border', 'border-radius', 'z-index'];

  function describe(el) {
    var computed = window.getComputedStyle(el);
    var styles = {};
    STYLE_PROPS.forEach(function (prop) {
      var value = computed.getPropertyValue(prop);
      if (value) styles[prop] = value;
    });
    var rect = el.getBoundingClientRect();
    return {
      type: 'pick',
      selector: selectorOf(el),
      html: clip(el.outerHTML, MAX_HTML),
      text: clip((el.innerText || '').trim(), 300),
      styles: styles,
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      url: location.href
    };
  }

  function setInspecting(on) {
    inspecting = on;
    if (!on && box) box.style.display = 'none';
    document.documentElement.style.cursor = on ? 'crosshair' : '';
    post({ type: 'inspect', on: on });
  }

  document.addEventListener('mousemove', function (event) {
    if (!inspecting) return;
    var el = event.target;
    if (!el || el === box || el.nodeType !== 1) return;
    var rect = el.getBoundingClientRect();
    var b = ensureBox();
    b.style.display = 'block';
    b.style.left = rect.left + 'px';
    b.style.top = rect.top + 'px';
    b.style.width = rect.width + 'px';
    b.style.height = rect.height + 'px';
  }, true);

  document.addEventListener('click', function (event) {
    if (!inspecting) return;
    event.preventDefault();
    event.stopPropagation();
    var el = event.target;
    if (el && el.nodeType === 1) post(describe(el));
    setInspecting(false);
  }, true);

  document.addEventListener('keydown', function (event) {
    if (inspecting && event.key === 'Escape') setInspecting(false);
  }, true);

  window.addEventListener('message', function (event) {
    if (event.source !== parentWin) return;
    var data = event.data;
    if (!data || data.aios !== 'preview-cmd') return;
    if (data.cmd === 'inspect') setInspecting(!!data.on);
  });

  post({ type: 'ready', url: location.href });
})();
`;
