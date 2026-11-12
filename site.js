// Dragonwilds Quest Guides.
// Index: filters, search, the done checklist, progress on cards, "pick up where you left off".
// Guide pages: tickable steps and items, the follow bar, maps, contents highlight, picture viewer.
// Everything is kept in this browser (localStorage); the page works without it.
(function () {
  'use strict';
  const NEW_DAYS = 45;
  const DONE_KEY = 'dq-done-v1';
  const PROG_KEY = 'dq-progress-v1';
  const load = (k, fallback) => {
    try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? fallback : v; } catch (e) { return fallback; }
  };
  const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } };
  const asArray = v => (Array.isArray(v) ? v.filter(x => typeof x === 'string') : []);
  let done = new Set(asArray(load(DONE_KEY, [])));
  let prog = load(PROG_KEY, {});
  if (!prog || typeof prog !== 'object' || Array.isArray(prog)) prog = {};
  const saveDone = () => store(DONE_KEY, [...done]);
  const saveProg = () => store(PROG_KEY, prog);
  const reload = () => {
    done = new Set(asArray(load(DONE_KEY, [])));
    const p = load(PROG_KEY, {});
    prog = p && typeof p === 'object' && !Array.isArray(p) ? p : {};
  };
  const reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const scrollTo = (el, block) => el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: block || 'start' });
  const typing = () => { const a = document.activeElement; return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable); };

  // "New" and "Updated" ribbons show for NEW_DAYS after the date.
  const now = Date.now();
  document.querySelectorAll('[data-new]').forEach(el => {
    const days = (now - Date.parse(el.dataset.new + 'T00:00:00Z')) / 864e5;
    el.hidden = !(days >= -1 && days <= NEW_DAYS);
  });

  // The "your own server" strip under the header: closing it hides it on every page.
  const modbarClose = document.getElementById('modbarClose');
  if (modbarClose) modbarClose.addEventListener('click', () => {
    const b = document.getElementById('modbar');
    if (b) b.remove();
    try { localStorage.setItem('dq-modbar-closed-v1', '1'); } catch (e) { /* private mode */ }
  });

  const page = document.body.dataset.slug;
  if (page) guide(page); else index();

  // ================= index =================
  function index() {
    const groupCards = [...document.querySelectorAll('.group .card')];
    const allCards = () => [...document.querySelectorAll('.card')];
    const q = document.getElementById('q');
    const region = document.getElementById('region');
    const hideDone = document.getElementById('hideDone');
    const segs = [...document.querySelectorAll('.seg button')];
    const latest = document.getElementById('latest');
    const cont = document.getElementById('continue');
    const contList = document.getElementById('contCards');
    let kind = 'all';

    const params = new URLSearchParams(location.search);
    const wantRegion = params.get('region');
    if (wantRegion && [...region.options].some(o => o.value === wantRegion)) region.value = wantRegion;
    const h = location.hash.slice(1);
    if (['primary', 'secondary', 'activity'].includes(h)) kind = h;
    segs.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.kind === kind)));

    const stepsDone = (slug, total) => {
      const p = prog[slug];
      return p && Array.isArray(p.s) ? Math.min(p.s.length, total) : 0;
    };
    const inProgress = c => !done.has(c.dataset.slug) && stepsDone(c.dataset.slug, +c.dataset.steps || 0) > 0;

    function paintCard(c) {
      const slug = c.dataset.slug, total = +c.dataset.steps || 0;
      const d = done.has(slug);
      c.classList.toggle('is-done', d);
      c.querySelector('.tick').hidden = !d;
      const bar = c.querySelector('.cprog');
      const got = stepsDone(slug, total);
      const show = !d && got > 0 && total > 0;
      bar.hidden = !show;
      if (show) {
        bar.querySelector('i').style.width = Math.round(100 * got / total) + '%';
        bar.title = got + ' of ' + total + ' steps';
      }
      const stat = c.querySelector('.cstat');
      stat.hidden = !show;
      stat.textContent = show ? got + ' of ' + total + ' steps done' : '';
    }
    function marks() {
      // Pick up where you left off: guides with ticked steps, most recent first.
      const seen = new Set();
      const started = groupCards.filter(c => inProgress(c) && !seen.has(c.dataset.slug) && seen.add(c.dataset.slug))
        .sort((a, b) => ((prog[b.dataset.slug] || {}).t || 0) - ((prog[a.dataset.slug] || {}).t || 0))
        .slice(0, 4);
      contList.replaceChildren(...started.map(c => { const k = c.cloneNode(true); k.hidden = false; return k; }));
      cont.dataset.has = started.length ? '1' : '';
      allCards().forEach(paintCard);

      const quests = new Set(groupCards.filter(c => c.dataset.kind !== 'activity').map(c => c.dataset.slug));
      const n = [...quests].filter(s => done.has(s)).length;
      document.getElementById('progress').hidden = n === 0;
      document.getElementById('bar').style.width = (100 * n / quests.size) + '%';
      document.getElementById('ptext').innerHTML = '<b>' + n + '</b> of ' + quests.size + ' quests done';

      // The next main-story quest, once someone has started the story.
      const story = groupCards.filter(c => c.dataset.kind === 'primary');
      const next = story.find(c => !done.has(c.dataset.slug));
      const begun = story.some(c => done.has(c.dataset.slug) || inProgress(c));
      const nu = document.getElementById('nextup');
      nu.hidden = !begun;
      if (begun) {
        nu.replaceChildren();
        if (next) {
          nu.append('Next in the story: ');
          const a = document.createElement('a');
          a.href = next.querySelector('a').getAttribute('href');
          a.textContent = next.querySelector('h3').textContent + ' →';
          nu.append(a);
        } else nu.textContent = 'You finished the main story. Well done!';
      }
    }
    function apply() {
      const term = q.value.trim().toLowerCase();
      const r = region.value;
      const filtering = !!(term || r || kind !== 'all' || hideDone.checked);
      if (latest) latest.hidden = filtering;
      cont.hidden = filtering || !cont.dataset.has;
      let shown = 0;
      const seen = new Set();
      groupCards.forEach(c => {
        const ok = (kind === 'all' || c.dataset.kind === kind) &&
          (!r || c.dataset.regions.split('|').includes(r)) &&
          (!hideDone.checked || !done.has(c.dataset.slug)) &&
          (!term || term.split(/\s+/).every(w => c.dataset.search.includes(w)));
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
    // Coming back from a guide (also from the back/forward cache).
    window.addEventListener('pageshow', () => { reload(); marks(); apply(); });
    window.addEventListener('keydown', e => {
      if (e.key === '/' && !typing()) { e.preventDefault(); q.focus(); }
    });
    marks(); apply();
    if (kind !== 'all' || region.value) document.getElementById('filters').scrollIntoView();
  }

  // ================= guide page =================
  function guide(slug) {
    const steps = [...document.querySelectorAll('.step[data-step]')];
    const needs = [...document.querySelectorAll('.need[data-need]')];
    const stepIds = new Set(steps.map(s => s.dataset.step));
    const needIds = new Set(needs.map(n => n.dataset.need));
    const entry = prog[slug] && typeof prog[slug] === 'object' ? prog[slug] : {};
    // Ticks for lines the wiki has since reworded are dropped.
    const sset = new Set(asArray(entry.s).filter(id => stepIds.has(id)));
    const iset = new Set(asArray(entry.i).filter(id => needIds.has(id)));
    const persist = () => {
      if (!sset.size && !iset.size) delete prog[slug];
      else prog[slug] = { s: [...sset], i: [...iset], t: Date.now() };
      saveProg();
    };

    // ---- done button ----
    const doneBtn = document.getElementById('doneBtn');
    const paintDone = () => {
      const d = done.has(slug);
      doneBtn.setAttribute('aria-pressed', String(d));
      doneBtn.querySelector('.lbl').textContent = d ? 'Done' : 'Mark as done';
    };
    doneBtn.addEventListener('click', () => {
      if (done.has(slug)) done.delete(slug); else { done.add(slug); burst(doneBtn); }
      saveDone(); paintDone();
    });
    paintDone();

    // ---- toast and confetti ----
    let toastTimer = 0;
    function toast(msg, action, fn) {
      let t = document.getElementById('toast');
      if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); document.body.append(t); }
      t.replaceChildren();
      const span = document.createElement('span'); span.textContent = msg; t.append(span);
      if (action) {
        const b = document.createElement('button'); b.type = 'button'; b.textContent = action;
        b.addEventListener('click', () => { fn(); t.classList.remove('show'); });
        t.append(b);
      }
      t.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => t.classList.remove('show'), 7000);
    }
    function burst(from) {
      if (reduceMotion) return;
      const c = document.createElement('canvas');
      c.className = 'confetti';
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      c.width = innerWidth * dpr; c.height = innerHeight * dpr;
      document.body.append(c);
      const x = c.getContext('2d');
      x.scale(dpr, dpr);
      const r = from ? from.getBoundingClientRect() : { left: innerWidth / 2, top: innerHeight / 2, width: 0, height: 0 };
      const ox = r.left + r.width / 2, oy = r.top + r.height / 2;
      const colors = ['#e9a948', '#d23c2a', '#2e8b57', '#5aa2ff', '#ffdd00', '#b06bff'];
      const ps = Array.from({ length: 140 }, () => {
        const a = Math.random() * Math.PI * 2, v = 4 + Math.random() * 8;
        return { x: ox, y: oy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 6, s: 4 + Math.random() * 5, r: Math.random() * 6, vr: Math.random() * .3 - .15, c: colors[(Math.random() * colors.length) | 0] };
      });
      const t0 = performance.now();
      (function frame(t) {
        const age = t - t0;
        x.clearRect(0, 0, innerWidth, innerHeight);
        ps.forEach(p => {
          p.vy += .28; p.vx *= .985; p.x += p.vx; p.y += p.vy; p.r += p.vr;
          x.save(); x.globalAlpha = Math.max(0, 1 - age / 2200); x.translate(p.x, p.y); x.rotate(p.r);
          x.fillStyle = p.c; x.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); x.restore();
        });
        if (age < 2200) requestAnimationFrame(frame); else c.remove();
      })(t0);
    }

    // ---- reading progress line ----
    const readbar = document.createElement('div');
    readbar.className = 'readbar';
    readbar.innerHTML = '<i></i>';
    document.body.append(readbar);

    // ---- steps ----
    const startBtn = document.getElementById('startBtn');
    let follow = null;
    steps.forEach((el, k) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'stepchk';
      b.innerHTML = '<span>' + (k + 1) + '</span>';
      b.title = 'Tick this step. Shift-click ticks every step up to here.';
      el.insertBefore(b, el.firstChild);
      if (el.tagName === 'LI') el.parentElement.classList.add('has-steps');
      b.addEventListener('click', e => {
        const wasAll = sset.size === steps.length;
        const on = !sset.has(el.dataset.step);
        if (on && e.shiftKey) steps.slice(0, k + 1).forEach(s => sset.add(s.dataset.step));
        else if (on) sset.add(el.dataset.step);
        else sset.delete(el.dataset.step);
        persist();
        paintSteps();
        if (!wasAll && sset.size === steps.length) finished(b);
      });
    });
    const nextStep = () => steps.find(s => !sset.has(s.dataset.step));
    function paintSteps() {
      const next = nextStep();
      steps.forEach((el, k) => {
        const on = sset.has(el.dataset.step);
        el.classList.toggle('checked', on);
        el.classList.toggle('next', el === next);
        const b = el.querySelector(':scope > .stepchk');
        b.setAttribute('aria-pressed', String(on));
        b.setAttribute('aria-label', 'Step ' + (k + 1) + (on ? ', done. Untick' : ': tick when done'));
      });
      if (startBtn) {
        const lbl = startBtn.querySelector('.lbl');
        if (!sset.size) lbl.textContent = 'Start the walkthrough';
        else if (next) lbl.textContent = 'Continue from step ' + (steps.indexOf(next) + 1);
        else lbl.textContent = 'All ' + steps.length + ' steps done';
      }
      if (follow) follow.paint();
    }
    function finished(from) {
      burst(from);
      if (!done.has(slug)) {
        done.add(slug); saveDone(); paintDone();
        toast('Quest complete! Marked as done.', 'Undo', () => { done.delete(slug); saveDone(); paintDone(); });
      } else toast('Every step done. Nice work!');
    }
    function goNext() {
      const n = nextStep();
      if (!n) { scrollTo(document.getElementById('top')); return; }
      scrollTo(n, 'center');
      n.classList.remove('flash');
      void n.offsetWidth;
      n.classList.add('flash');
    }
    if (startBtn) startBtn.addEventListener('click', e => {
      if (!sset.size) return; // first time: the link goes to the walkthrough heading
      e.preventDefault();
      goNext();
    });

    // ---- items to bring ----
    const mirror = new Map(); // item id -> its line in the bag panel
    let needCount = null;
    if (needs.length) {
      const row = needs[0].closest('.qd-row');
      const key = row && row.querySelector('.qd-k');
      if (key) {
        needCount = document.createElement('span');
        needCount.className = 'needcount';
        const copy = document.createElement('button');
        copy.type = 'button';
        copy.className = 'copylist';
        copy.textContent = 'Copy list';
        copy.addEventListener('click', () => {
          const lines = needs.map(li => { const k = li.cloneNode(true); k.querySelectorAll('button').forEach(b => b.remove()); return '- ' + k.textContent.replace(/\s+/g, ' ').trim(); });
          const txt = document.title.split(' · ')[0] + ', items to bring:\n' + lines.join('\n');
          const ok = () => { copy.textContent = 'Copied'; setTimeout(() => { copy.textContent = 'Copy list'; }, 1600); };
          if (navigator.clipboard) navigator.clipboard.writeText(txt).then(ok, () => {});
        });
        key.append(needCount, copy);
      }
    }
    const toggleNeed = id => { if (iset.has(id)) iset.delete(id); else iset.add(id); persist(); paintNeeds(); };
    needs.forEach(li => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'needchk';
      li.insertBefore(b, li.firstChild);
      li.parentElement.classList.add('has-needs');
      b.addEventListener('click', () => toggleNeed(li.dataset.need));
    });
    function paintNeeds() {
      needs.forEach(li => {
        const on = iset.has(li.dataset.need);
        li.classList.toggle('got', on);
        const b = li.querySelector(':scope > .needchk');
        b.setAttribute('aria-pressed', String(on));
        b.setAttribute('aria-label', on ? 'Got it. Untick' : 'Tick when you have it');
        const m = mirror.get(li.dataset.need);
        if (m) { m.classList.toggle('got', on); m.querySelector('button').setAttribute('aria-pressed', String(on)); }
      });
      if (needCount) needCount.textContent = iset.size + ' / ' + needs.length + ' packed';
      if (follow) follow.paint();
    }

    // ---- the follow bar ----
    if (steps.length || needs.length) {
      const bar = document.createElement('div');
      bar.className = 'follow';
      bar.setAttribute('role', 'region');
      bar.setAttribute('aria-label', 'Your progress in this guide');
      bar.innerHTML =
        (steps.length ? '<div class="ring" aria-hidden="true"><svg viewBox="0 0 36 36"><circle class="bg" cx="18" cy="18" r="15.5"/><circle class="fg" cx="18" cy="18" r="15.5"/></svg><span class="pct"></span></div>' +
          '<div class="ftext"><b class="fstep"></b><small class="fsect"></small></div>' +
          '<button type="button" class="fbtn primary fgo">Continue</button>' : '<div class="ftext"><b>Items to bring</b><small class="fsect"></small></div>') +
        (needs.length ? '<button type="button" class="fbtn fbag" aria-expanded="false"><img src="../img/icons/chest.png" alt="" width="48" height="48"> <span class="fbagn"></span></button>' : '') +
        '<button type="button" class="fbtn icon ftop" aria-label="Back to top">↑</button>' +
        (needs.length ? '<div class="bag" hidden><p>Items to bring</p><ul></ul></div>' : '');
      document.body.append(bar);
      const C = 2 * Math.PI * 15.5;
      const fg = bar.querySelector('.fg');
      if (fg) { fg.style.strokeDasharray = C; fg.style.strokeDashoffset = C; }
      const bag = bar.querySelector('.bag');
      const bagBtn = bar.querySelector('.fbag');
      if (bag) {
        const ul = bag.querySelector('ul');
        needs.forEach(li => {
          const item = document.createElement('li');
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'needchk';
          b.addEventListener('click', () => toggleNeed(li.dataset.need));
          const label = li.cloneNode(true);
          label.querySelectorAll('button').forEach(x => x.remove());
          label.querySelectorAll('img').forEach(x => x.remove());
          const span = document.createElement('span');
          span.textContent = label.textContent.replace(/\s+/g, ' ').trim();
          b.setAttribute('aria-label', span.textContent);
          item.append(b, span);
          ul.append(item);
          mirror.set(li.dataset.need, item);
        });
        const openBag = open => { bag.hidden = !open; bagBtn.setAttribute('aria-expanded', String(open)); };
        bagBtn.addEventListener('click', () => openBag(bag.hidden));
        document.addEventListener('click', e => { if (!bag.hidden && !bar.contains(e.target)) openBag(false); });
        window.addEventListener('keydown', e => { if (e.key === 'Escape') openBag(false); });
      }
      const go = bar.querySelector('.fgo');
      if (go) go.addEventListener('click', goNext);
      bar.querySelector('.ftop').addEventListener('click', () => scrollTo(document.getElementById('top')));
      follow = {
        paint() {
          if (steps.length) {
            const n = sset.size, next = nextStep();
            bar.querySelector('.pct').textContent = n;
            fg.style.strokeDashoffset = C * (1 - n / steps.length);
            bar.querySelector('.fstep').textContent = next ? 'Step ' + (steps.indexOf(next) + 1) + ' of ' + steps.length : 'All ' + steps.length + ' steps done';
            go.textContent = !n ? 'Start' : next ? 'Continue' : 'Top';
            bar.classList.toggle('complete', !next);
          }
          if (bagBtn) bar.querySelector('.fbagn').textContent = iset.size + '/' + needs.length;
        },
        sect(t) { const s = bar.querySelector('.fsect'); if (s.textContent !== t) s.textContent = t; },
      };
      // Shown once the header is scrolled away.
      const hero = document.querySelector('.ghero');
      if ('IntersectionObserver' in window && hero) {
        new IntersectionObserver(es => es.forEach(e => bar.classList.toggle('show', !e.isIntersecting))).observe(hero);
      } else bar.classList.add('show');
      document.body.classList.add('has-follow');
    }

    // Where am I: the section under the top of the screen (for the follow bar and the
    // contents list), and how far down the page.
    const heads = [...document.querySelectorAll('.content section > h2, .content section > h3, .content section > h4')];
    const idOf = a => { try { return decodeURIComponent(a.hash.slice(1)); } catch (e) { return ''; } };
    const tocLinks = [...document.querySelectorAll('.toc a')].map(a => ({ a, el: document.getElementById(idOf(a)), sub: !!a.closest('ol ol') })).filter(x => x.el);
    let ticking = false;
    function onScroll() {
      ticking = false;
      const max = document.documentElement.scrollHeight - innerHeight;
      readbar.firstChild.style.width = (max > 0 ? Math.min(100, 100 * scrollY / max) : 0) + '%';
      if (follow) {
        let cur = '';
        for (const h of heads) { if (h.getBoundingClientRect().top < 140) cur = h.textContent.trim(); else break; }
        follow.sect(cur);
      }
      let top = null, sub = null;
      for (const t of tocLinks) {
        if (t.el.getBoundingClientRect().top >= 160) continue;
        if (t.sub) sub = t; else { top = t; sub = null; }
      }
      if (!top && tocLinks.length) top = tocLinks.find(t => !t.sub);
      tocLinks.forEach(t => t.a.classList.toggle('on', t === top || t === sub));
    }
    window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
    window.addEventListener('resize', onScroll);
    window.addEventListener('keydown', e => {
      if (typing() || e.ctrlKey || e.metaKey || e.altKey) return;
      if ((e.key === 'n' || e.key === 'N') && steps.length) { e.preventDefault(); goNext(); }
    });
    paintSteps(); paintNeeds(); onScroll();

    // ---- folded sections open when linked to ----
    function openHash() {
      let id = '';
      try { id = decodeURIComponent(location.hash.slice(1)); } catch (e) { return; }
      const el = id && document.getElementById(id);
      const d = el && (el.tagName === 'DETAILS' ? el : el.closest('details'));
      if (d && !d.open) { d.open = true; el.scrollIntoView(); }
    }
    window.addEventListener('hashchange', openHash);
    openHash();

    // ---- picture viewer ----
    const box = document.getElementById('lightbox');
    const boxImg = box.querySelector('img');
    document.addEventListener('click', e => {
      const a = e.target.closest('a.zoom');
      if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      boxImg.src = a.href;
      boxImg.alt = (a.querySelector('img') || {}).alt || '';
      box.hidden = false;
      box.querySelector('button').focus();
    });
    const close = () => { box.hidden = true; boxImg.removeAttribute('src'); };
    box.addEventListener('click', close);
    window.addEventListener('keydown', e => { if (e.key === 'Escape' && !box.hidden) close(); });

    // ---- maps: the wiki's world map (tiles from the penguin map), built when scrolled to ----
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
      if (el.dataset.ready || !el.offsetWidth) return;
      el.dataset.ready = '1';
      let data;
      try { data = JSON.parse(el.dataset.map); } catch (e) { return; }
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
      el.addEventListener('click', () => map.scrollWheelZoom.enable(), { once: true });
    }
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting && e.target.offsetWidth) { build(e.target); io.unobserve(e.target); } }), { rootMargin: '300px' });
      maps.forEach(m => io.observe(m));
    } else maps.forEach(build);
    // A map inside a folded section is built when it opens.
    document.querySelectorAll('details').forEach(d => d.addEventListener('toggle', () => {
      if (d.open) d.querySelectorAll('.qmap').forEach(build);
    }));
  }
})();
