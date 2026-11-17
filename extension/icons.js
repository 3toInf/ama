// Small, local SVG UI icons. Website identities come from Chrome's favicon cache.
const paths = {
  globe: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3c4 4 4 14 0 18-4-4-4-14 0-18Z',
  search: 'M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0Zm-1.5 4.5L21 21',
  plus: 'M12 5v14M5 12h14',
  close: 'm6 6 12 12M6 18 18 6',
  folder: 'M3 7V5h6l2 2h10v12H3V7Z',
  chevron: 'm9 5 7 7-7 7',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  pin: 'm9 3 6 0-1 5 4 4v2H6v-2l4-4-1-5Zm3 11v7',
  archive: 'M4 8h16v12H4V8ZM3 4h18v4H3V4Zm6 8h6',
  restore: 'M4 10a8 8 0 1 1 1 8M4 4v6h6M12 8v5l3 2',
  external: 'M14 3h7v7m0-7L10 14M10 5H4v15h15v-6',
  split: 'M3 4h18v16H3V4Zm9 0v16',
  unsplit: 'M3 4h18v16H3V4Zm6 8h6m-3-3 3 3-3 3',
  panel: 'M3 4h18v16H3V4Zm6 0v16M5.5 8h1M5.5 11h1',
  settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm-2-5h4l1 3 3-1 2 3-2 3 2 3-2 3-3-1-1 3h-4l-1-3-3 1-2-3 2-3-2-3 2-3 3 1 1-3Z',
  command: 'M8 8H5a3 3 0 1 1 3-3v14a3 3 0 1 1-3-3h14a3 3 0 1 1-3 3V5a3 3 0 1 1 3 3H8Z',
  volume: 'M11 4 6 8H3v8h3l5 4V4Zm4 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14',
};

export function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    'stroke-width': '1.7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: 'ui-icon' })) {
    svg.setAttribute(key, value);
  }
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', paths[name] || paths.globe);
  svg.append(path);
  return svg;
}

export function faviconUrl(pageUrl, runtime = chrome.runtime) {
  try {
    const page = new URL(pageUrl);
    if (!['https:', 'http:'].includes(page.protocol) || page.username || page.password) return null;
    const url = new URL(runtime.getURL('/_favicon/'));
    url.searchParams.set('pageUrl', page.href);
    url.searchParams.set('size', '32');
    return url.href;
  } catch { return null; }
}

export function siteIcon(pageUrl) {
  const wrapper = document.createElement('span');
  wrapper.className = 'site-icon';
  wrapper.setAttribute('aria-hidden', 'true');
  wrapper.append(icon('globe'));
  const url = faviconUrl(pageUrl);
  if (url) {
    const image = document.createElement('img');
    image.alt = '';
    image.width = image.height = 16;
    image.decoding = 'async';
    image.hidden = true;
    image.addEventListener('load', () => {
      image.hidden = false;
      wrapper.classList.add('has-favicon');
    });
    image.addEventListener('error', () => {
      image.hidden = true;
      wrapper.classList.remove('has-favicon');
    });
    image.src = url;
    wrapper.append(image);
  }
  return wrapper;
}

export function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach(node => node.replaceChildren(icon(node.dataset.icon)));
}
