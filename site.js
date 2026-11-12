// Dragonwilds Quest Guides: done-checklist, "New" ribbons, filters on the index,
// and on guide pages the maps, the contents highlight and the picture viewer.
(function () {
  'use strict';
  const NEW_DAYS = 45;
  const KEY = 'dq-done-v1';
  let done = new Set();
  try { done = new Set(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch (e) { /* private mode */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify([...done])); } catch (e) { /* ignore */ } };

  // "New" and "Updated" ribbons show for NEW_DAYS after the date.
  const today = Date.now();
  document.querySelectorAll('[data-new]').forEach(el => {
    const days = (today - Date.parse(el.dataset.new + 'T00:00:00Z')) / 864e5;
    el.hidden = !(days >= -1 && days <= NEW_DAYS);
  });

  const page = document.body.dataset.slug;
  if (page) guide(page); else index();

  // ---------- index ----------
  function index() {
    const cards = [...document.querySelectorAll('.card')];
    const q = document.getElementById('q');
    const region = document.getElementById('region');
    const hideDone = document.getElementById('hideDone');
    const segs = [...document.querySelectorAll('.seg button')];
    const latest = document.getElementById('latest');
    let kind = 'all';

    const params = new URLSearchParams(location.search);
    if (params.get('region')) region.value = params.get('region');
    const h = location.hash.slice(1);
    if (['primary', 'secondary', 'activity'].includes(h)) kind = h;
    segs.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.kind === kind)));

    function marks() {
      cards.forEach(c => {
        const d = done.has(c.dataset.slug);
        c.classList.toggle('is-done', d);
        c.querySelector('.tick').hidden = !d;
      });
      const quests = new Set(cards.filter(c => c.dataset.kind !== 'activity').map(c => c.dataset.slug));
      const n = [...quests].filter(s => done.has(s)).length;
      const p = document.getElementById('progress');
      p.hidden = n === 0;
      document.getElementById('bar').style.width = (100 * n / quests.size) + '%';
      document.getElementById('ptext').innerHTML = '<b>' + n + '</b> of ' + quests.size + ' quests done';
    }
    function apply() {
      const term = q.value.trim().toLowerCase();
      const r = region.value;
      const filtering = term || r || kind !== 'all' || hideDone.checked;
      if (latest) latest.hidden = !!filtering;
      let shown = 0;
      const seen = new Set();
      document.querySelectorAll('.group .card').forEach(c => {
        const ok = (kind === 'all' || c.dataset.kind === kind) &&
          (!r || c.dataset.regions.split('|').includes(r)) &&
          (!hideDone.checked || !done.has(c.dataset.slug)) &&
          (!term || term.split(/\s+/).every(w => c.dataset.search.includes(w) || c.querySelector('h3').textContent.toLowerCase().includes(w)));
        c.hidden = !ok;
        if (ok && !seen.has(c.dataset.slug)) { shown++; seen.add(c.dataset.slug); }
      });
      document.querySelectorAll('.region').forEach(el => { el.hidden = !el.querySelector('.card:not([hidden])'); });
      document.querySelectorAll('.group').forEach(el => { el.hidden = !el.querySelector('.card:not([hidden])'); });
      document.getElementById('count').textContent = filtering ? shown + (shown === 1 ? ' guide' : ' guides') : '';
      document.getElementById('empty').hidden = shown > 0;
    }
    segs.forEach(b => b.addEventListener('click', () => {
      kind = b.dataset.kind;
      segs.forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      apply();
    }));
    q.addEventListener('input', apply);
    region.addEventListener('change', apply);
    hideDone.addEventListener('change', apply);
    document.getElementById('clear').addEventListener('click', () => {
      q.value = ''; region.value = ''; hideDone.checked = false; kind = 'all';
      segs.forEach(x => x.setAttribute('aria-pressed', String(x.dataset.kind === 'all')));
      apply();
    });
    // Coming back from a guide where something was ticked.
    window.addEventListener('pageshow', () => {
      try { done = new Set(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch (e) { /* ignore */ }
      marks(); apply();
    });
    window.addEventListener('keydown', e => {
      if (e.key === '/' && document.activeElement !== q) { e.preventDefault(); q.focus(); }
    });
    marks(); apply();
    if (kind !== 'all' || params.get('region')) document.getElementById('filters').scrollIntoView();
  }

  // ---------- guide page ----------
  function guide(slug) {
    const btn = document.getElementById('doneBtn');
    const paint = () => {
      const d = done.has(slug);
      btn.setAttribute('aria-pressed', String(d));
      btn.querySelector('.lbl').textContent = d ? 'Done' : 'Mark as done';
    };
    btn.addEventListener('click', () => {
      if (done.has(slug)) done.delete(slug); else done.add(slug);
      save(); paint();
    });
    paint();

    // Folded sections open when linked to.
    function openHash() {
      const id = decodeURIComponent(location.hash.slice(1));
      const el = id && document.getElementById(id);
      const d = el && (el.tagName === 'DETAILS' ? el : el.closest('details'));
      if (d && !d.open) { d.open = true; el.scrollIntoView(); }
    }
    window.addEventListener('hashchange', openHash);
    openHash();

    // Contents: highlight the section on screen.
    const links = [...document.querySelectorAll('.toc > ol > li > a')];
    if (links.length && 'IntersectionObserver' in window) {
      const targets = links.map(a => document.getElementById(decodeURIComponent(a.hash.slice(1)))).filter(Boolean);
      const vis = new Map();
      const io = new IntersectionObserver(es => {
        es.forEach(e => vis.set(e.target, e.isIntersecting));
        const first = targets.find(t => vis.get(t));
        if (first) links.forEach(a => a.classList.toggle('on', decodeURIComponent(a.hash.slice(1)) === first.id));
      }, { rootMargin: '0px 0px -70% 0px' });
      targets.forEach(t => io.observe(t));
    }

    // Picture viewer.
    const box = document.getElementById('lightbox');
    const boxImg = box.querySelector('img');
    document.addEventListener('click', e => {
      const a = e.target.closest('a.zoom');
      if (!a || e.ctrlKey || e.metaKey || e.shiftKey) return;
      e.preventDefault();
      boxImg.src = a.href;
      boxImg.alt = (a.querySelector('img') || {}).alt || '';
      box.hidden = false;
    });
    const close = () => { box.hidden = true; boxImg.removeAttribute('src'); };
    box.addEventListener('click', close);
    window.addEventListener('keydown', e => { if (e.key === 'Escape' && !box.hidden) close(); });

    // Maps: the wiki's map of Ashenfall (tiles from the penguin map), built when scrolled to.
    const maps = [...document.querySelectorAll('.qmap')];
    if (!maps.length || !window.L) return;
    const TILES = 'https://joaopmsilva.github.io/dragonwilds-penguins/tiles/{z}/{x}_{y}.png';
    const mult = 6144 / 420000 / 16, offX = 11075, offY = 117685;
    const crs = L.extend({}, L.CRS.Simple, {
      projection: L.Projection.LonLat,
      transformation: new L.Transformation(mult, mult * offX, mult, mult * offY),
    });
    const bounds = L.latLngBounds([[-offY, -offX], [420000 - offY, 420000 - offX]]);
    function build(el) {
      if (el.dataset.ready) return;
      el.dataset.ready = '1';
      const data = JSON.parse(el.dataset.map);
      const map = L.map(el, { crs, maxBounds: bounds.pad(0.1), minZoom: 0, maxZoom: 6, zoomSnap: 1, scrollWheelZoom: false, attributionControl: false });
      L.tileLayer(TILES, { minNativeZoom: 0, maxNativeZoom: 4, maxZoom: 6, bounds, noWrap: true }).addTo(map);
      const pts = [];
      data.markers.forEach(m => {
        const ll = L.latLng(m.y, m.x);
        pts.push(ll);
        const icon = m.icon
          ? L.icon({ iconUrl: '../' + m.icon, iconSize: [30, 30], iconAnchor: [15, 15], popupAnchor: [0, -14], className: 'qicon' })
          : L.divIcon({ className: '', html: '<div class="qpin"></div>', iconSize: [18, 18], iconAnchor: [9, 9], popupAnchor: [0, -8] });
        const html = (m.t ? '<span class="pop-t">' + m.t + '</span>' : '') + (m.d || '');
        const mk = L.marker(ll, { icon, title: (m.t || '').replace(/<[^>]+>/g, '') }).addTo(map);
        if (html) mk.bindPopup(html, { maxWidth: 280 });
      });
      if (pts.length === 1) map.setView(pts[0], 3);
      else map.fitBounds(L.latLngBounds(pts).pad(0.25), { maxZoom: 4 });
      map.once('focus', () => map.scrollWheelZoom.enable());
      el.addEventListener('click', () => map.scrollWheelZoom.enable(), { once: true });
    }
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { build(e.target); io.unobserve(e.target); } }), { rootMargin: '300px' });
      maps.forEach(m => io.observe(m));
    } else maps.forEach(build);
    // A map inside a folded section is sized when it opens.
    document.querySelectorAll('details').forEach(d => d.addEventListener('toggle', () => {
      d.querySelectorAll('.qmap').forEach(build);
      window.dispatchEvent(new Event('resize'));
    }));
  }
})();
