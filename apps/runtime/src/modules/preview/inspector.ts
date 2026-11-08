/**
 * Skrip inspector yang disuntikkan ke halaman preview (Design Mode).
 * Ditulis sebagai String.raw agar escape regex tetap utuh. ES2020-safe.
 */
export const INSPECTOR_SCRIPT = String.raw`(function () {
  var enabled = false;
  var last = null;
  var style = document.createElement('style');
  style.textContent = '.dorado-pick-hover{outline:2px solid #f0b45c !important;outline-offset:1px !important;}';
  document.documentElement.appendChild(style);

  function selectorFor(el) {
    if (!el || el.nodeType !== 1) return '';
    var parts = [];
    var node = el;
    while (node && node.nodeType === 1 && parts.length < 6) {
      var tag = node.tagName.toLowerCase();
      if (node.id) { parts.unshift(tag + '#' + node.id); break; }
      var cls = (node.getAttribute('class') || '').split(/\s+/).filter(Boolean).slice(0, 2).join('.');
      var parent = node.parentElement;
      var index = 1;
      if (parent) {
        var siblings = Array.prototype.slice.call(parent.children).filter(function (c) { return c.tagName === node.tagName; });
        index = siblings.indexOf(node) + 1;
      }
      parts.unshift(tag + (cls ? '.' + cls : '') + ':nth-of-type(' + index + ')');
      node = parent;
    }
    return parts.join(' > ');
  }

  function stylesFor(el) {
    var cs = window.getComputedStyle(el);
    var rect = el.getBoundingClientRect();
    return {
      color: cs.color,
      backgroundColor: cs.backgroundColor,
      fontSize: cs.fontSize,
      padding: cs.padding,
      margin: cs.margin,
      display: cs.display,
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    };
  }

  function onMove(e) {
    if (!enabled) return;
    if (last && last.classList) last.classList.remove('dorado-pick-hover');
    last = e.target;
    if (last && last.classList) last.classList.add('dorado-pick-hover');
  }

  function onClick(e) {
    if (!enabled) return;
    e.preventDefault();
    e.stopPropagation();
    var el = e.target;
    window.parent.postMessage({
      type: 'DORADO_DOM_PICK',
      tagName: el.tagName ? el.tagName.toLowerCase() : '',
      selector: selectorFor(el),
      html: el.outerHTML ? el.outerHTML.slice(0, 500) : '',
      styles: stylesFor(el)
    }, '*');
  }

  window.addEventListener('message', function (event) {
    var data = event.data || {};
    if (data.type === 'DORADO_INSPECT_ON') {
      enabled = true;
      document.documentElement.style.cursor = 'crosshair';
    } else if (data.type === 'DORADO_INSPECT_OFF') {
      enabled = false;
      document.documentElement.style.cursor = '';
      if (last && last.classList) last.classList.remove('dorado-pick-hover');
      last = null;
    }
  });

  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('click', onClick, true);
  window.parent.postMessage({ type: 'DORADO_INSPECTOR_READY' }, '*');
})();`;
