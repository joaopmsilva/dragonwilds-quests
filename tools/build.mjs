// Builds the site from the RuneScape: Dragonwilds Wiki.
//
//   npm install
//   npm run build              uses pages already in .cache/ when it has them
//   npm run build -- --refresh  fetches every page again (after a game update)
//
// It reads the wiki's quest lists, fetches each guide's rendered article through the
// wiki's API, keeps the guide itself (no navigation boxes, edit links or notices),
// turns the wiki's maps into Leaflet maps, saves every picture as WebP in img/, and
// writes index.html plus one folder per guide. Text and pictures are the wiki's,
// under CC BY-NC-SA 3.0, and every page says so and links back.
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import * as cheerio from 'cheerio';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const CACHE = path.join(ROOT, '.cache');
const WIKI = 'https://dragonwilds.runescape.wiki';
const API = WIKI + '/api.php';
const SITE = 'https://joaopmsilva.github.io/dragonwilds-quests/';
const PENGUINS = 'https://joaopmsilva.github.io/dragonwilds-penguins/';
const MOD = 'https://joaopmsilva.github.io/RSDWServerAPI/';
const REPO = 'https://github.com/joaopmsilva/dragonwilds-quests';
const KOFI = 'https://ko-fi.com/paradoxjs';
const UA = 'dragonwilds-quests-builder/1.0 (+https://github.com/joaopmsilva/dragonwilds-quests)';
const REFRESH = process.argv.includes('--refresh');

// Activities aren't in the wiki's quest lists, so they're listed here. Dates the wiki
// doesn't give come from the update notes (Update:Eye on Ashenfall - 1.0.2).
const ACTIVITIES = [
  { page: 'The Rug Pull', region: 'Umbral Sands', released: '10 November 2026' },
  { page: 'Penguin Hunting', title: 'Penguin Hunting', region: 'Everywhere', released: '10 November 2026', penguins: true },
  { page: 'X Marks The Spot', region: 'Fellhollow' },
  { page: 'Statues of Saradomin' },
  { page: 'Agility Course' },
  { page: 'Spectral Bird', title: 'Spectral Birds' },
  { page: 'Scarecrow Scavenging' },
  { page: 'Fight Cave' },
  { page: 'Nightmare Crucible' },
];
// Guides that gained something in a later update.
const UPDATED = {
  'Letters for the Dead': { date: '10 November 2026', note: 'New letter routes in Dowdun Reach and Umbral Sands' },
};
const REGIONS = {
  'Temple Woods': '#3f8f7f', Brynmoor: '#1b8a3a', Ghornfell: '#c99400', Fellhollow: '#7b3fbf',
  'Dowdun Reach': '#1f6fd1', 'Umbral Sands': '#e0601a', 'Scorned Wilderness': '#b0204a', Everywhere: '#5b6876',
};
const REGION_ORDER = Object.keys(REGIONS);
// Sections kept but folded away, and sections dropped.
const FOLD = new Set(['transcript', 'update history', 'journal entry', 'journal']);
const DROP = new Set(['references']);

// ---------- fetching ----------
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(url, binary = false) {
  for (let tries = 0; ; tries++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA } });
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return binary ? Buffer.from(await res.arrayBuffer()) : res.json();
    } catch (err) {
      if (tries >= 3) throw err;
      await sleep(1500 * (tries + 1));
    }
  }
}
async function cached(name, fn) {
  const file = path.join(CACHE, name);
  if (!REFRESH && existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const data = await fn();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data));
  await sleep(300);
  return data;
}
const wikitext = page => cached(`lists/${encodeURIComponent(page)}.json`, async () =>
  (await get(`${API}?action=parse&format=json&formatversion=2&prop=wikitext&page=${encodeURIComponent(page)}`)).parse.wikitext);
const parsePage = page => cached(`pages/${encodeURIComponent(page)}.json`, async () => {
  const j = await get(`${API}?action=parse&format=json&formatversion=2&redirects=1&disableeditsection=1&disablelimitreport=1&prop=text|displaytitle|revid&page=${encodeURIComponent(page)}`);
  if (j.error) throw new Error(`${page}: ${j.error.info}`);
  return j.parse;
});

// ---------- the quest lists ----------
const unlink = s => s.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').replace(/<[^>]+>/g, '').trim();
const linkTarget = s => (s.match(/\[\[([^\]|]+)/) || [])[1]?.trim();
function wikiTable(text) {
  const body = text.slice(text.indexOf('{|'), text.indexOf('|}'));
  const chunks = body.split(/\n\|-/);
  const head = chunks[0].split('\n').filter(l => l.startsWith('!')).map(l => unlink(l.slice(1)));
  const carry = head.map(() => null);
  const rows = [];
  for (const chunk of chunks.slice(1)) {
    const cells = chunk.split('\n').filter(l => l.startsWith('|') && !l.startsWith('|}')).map(l => {
      const m = l.slice(1).match(/^\s*rowspan="(\d+)"\s*\|(.*)$/);
      return m ? { v: m[2].trim(), span: +m[1] } : { v: l.slice(1).trim(), span: 1 };
    });
    if (!cells.length) continue;
    const row = {};
    head.forEach((h, i) => {
      if (carry[i] && carry[i].left > 0) { row[h] = carry[i].v; carry[i].left--; return; }
      const c = cells.shift();
      if (!c) return;
      row[h] = c.v;
      carry[i] = c.span > 1 ? { v: c.v, left: c.span - 1 } : null;
    });
    rows.push(row);
  }
  return rows;
}
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function isoDate(s) {
  const m = String(s || '').match(/(\d{1,2})\s+([A-Z][a-z]+)\s+(\d{4})/);
  if (!m || !MONTHS.includes(m[2])) return null;
  return `${m[3]}-${String(MONTHS.indexOf(m[2]) + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}
const niceDate = iso => { const [y, m, d] = iso.split('-'); return `${+d} ${MONTHS[+m - 1]} ${y}`; };
// A short id from a line's text, so ticks survive a rebuild while the wording stays the same.
function stableId(t, used) {
  const base = createHash('sha1').update(t).digest('hex').slice(0, 8);
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
  used.add(id);
  return id;
}
const slugify = s => s.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const regionsOf = s => s.split('/').map(r => r.trim()).filter(Boolean);

async function guideList() {
  const guides = [];
  const primary = wikiTable(await wikitext('List of primary quests'));
  primary.forEach((r, i) => guides.push({
    page: linkTarget(r.Quests), title: unlink(r.Quests), kind: 'primary', order: i,
    regions: regionsOf(unlink(r['Region/area'])),
    saga: /tutorial/i.test(r['Saga/Type']) ? 'Tutorial' : unlink(r['Saga/Type']).replace(/'s$/, "'s Saga"),
    released: isoDate(r['Release Date']),
  }));
  const secondary = wikiTable(await wikitext('List of secondary quests'));
  secondary.forEach((r, i) => guides.push({
    page: linkTarget(r.Quests), title: unlink(r.Quests), kind: 'secondary', order: i,
    regions: regionsOf(unlink(r['Region/Area'])), released: isoDate(r.Date),
  }));
  ACTIVITIES.forEach((a, i) => guides.push({
    page: a.page, title: a.title || a.page, kind: 'activity', order: i,
    regions: a.region ? [a.region] : [], released: isoDate(a.released), penguins: a.penguins,
  }));
  for (const g of guides) {
    g.slug = slugify(g.title);
    if (UPDATED[g.title]) g.updated = { date: isoDate(UPDATED[g.title].date), note: UPDATED[g.title].note };
  }
  return guides;
}

// ---------- pictures ----------
const imgDir = path.join(ROOT, 'img');
const done = new Map();
const usedImages = new Set();
function fileFromSrc(src) {
  const p = src.split('?')[0];
  const m = p.match(/^\/images\/thumb\/([^/]+)\//) || p.match(/^\/images\/([^/]+)$/);
  return m ? m[1] : null; // still URL-encoded
}
// Saves a picture at `want` px wide (never wider than the file) and returns its path.
async function picture(file, fileW, want, directUrl) {
  const w = Math.max(1, Math.min(Math.round(want), fileW || want));
  const name = decodeURIComponent(file);
  const base = slugify(name.replace(/\.[a-z0-9]+$/i, '')).slice(0, 60) || 'image';
  const out = `${base}-${createHash('sha1').update(name).digest('hex').slice(0, 6)}-${w}.webp`;
  usedImages.add(out);
  if (done.has(out)) return done.get(out);
  const job = (async () => {
    if (!existsSync(path.join(imgDir, out))) {
      const src = await original(file, fileW, directUrl);
      await sharp(src).resize({ width: w, withoutEnlargement: true }).webp({ quality: w <= 96 ? 90 : 80, effort: 5 }).toFile(path.join(imgDir, out));
    }
    return 'img/' + out;
  })();
  done.set(out, job);
  return job;
}
// One download per file, at most 1600 px wide.
const originals = new Map();
function original(file, fileW, directUrl) {
  if (!originals.has(file)) originals.set(file, (async () => {
    const name = decodeURIComponent(file) + (directUrl ? '.poster.jpg' : '');
    const local = path.join(CACHE, 'img', createHash('sha1').update(name).digest('hex') + path.extname(name).toLowerCase());
    if (existsSync(local)) return local;
    const svg = /\.svg$/i.test(name);
    const url = directUrl ? directUrl : fileW > 1600 || svg
      ? `${WIKI}/images/thumb/${file}/${Math.min(fileW || 1600, 1600)}px-${file}${svg ? '.png' : ''}`
      : `${WIKI}/images/${file}`;
    const buf = await get(url, true);
    mkdirSync(path.dirname(local), { recursive: true });
    writeFileSync(local, buf);
    await sleep(150);
    return local;
  })());
  return originals.get(file);
}

// ---------- turning a wiki article into a guide ----------
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const text = s => String(s).replace(/\s+/g, ' ').trim();
// World map bounds (the wiki's map, game units).
const MAP = { x0: -11075, y0: -117685, size: 420000 };
const onMap = ([x, y]) => x >= MAP.x0 && y >= MAP.y0 && x <= MAP.x0 + MAP.size && y <= MAP.y0 + MAP.size;

async function buildGuide(g, byTitle, redirects) {
  const parsed = await parsePage(g.page);
  g.wikiTitle = parsed.title;
  g.revid = parsed.revid;
  const $ = cheerio.load(parsed.text, null, false);
  const root = $('.mw-parser-output').length ? $('.mw-parser-output').first() : $.root();

  // Facts from the infobox, then the infobox goes.
  const info = {};
  $('.infobox .infobox-row-container').each((_, e) => { info[text($(e).find('.infobox-row-label').text())] = text($(e).find('.infobox-row-value').text()); });
  // The article's own infobox links the update that added it; prefer it over the list.
  if (info.Released && isoDate(info.Released)) g.released = isoDate(info.Released);
  if (info['Quest series'] && g.kind === 'primary' && !g.saga) g.saga = info['Quest series'];
  let heroImg = $('.infobox .infobox-image img').first();
  heroImg = heroImg.length ? { file: fileFromSrc(heroImg.attr('src')), w: +heroImg.attr('data-file-width') || +heroImg.attr('width') } : null;
  $('.infobox').remove();

  // Everything that is wiki furniture rather than guide.
  $('style, script, link, meta, input, label.toctogglelabel').remove();
  $('.rs-external-header-links, .hatnote, #toc, .toc, .navbox, .mw-references-wrap, .reflist, sup.reference, .clear-template, .mw-empty-elt, .mw-cite-backlink, .notpageimage, sup.noprint, .map-multiple-points-notice').remove();
  // The wiki's map has a filter button; these maps don't, so its instructions go.
  $('p').each((_, p) => { if (/stacked square tile|filter one or more spawn points/i.test($(p).text())) $(p).remove(); });
  // Wiki placeholders: a template that isn't there ("Template:Wanted!") and "click to edit" stubs.
  $('p').each((_, p) => { if (/^Template:S/.test(text($(p).text()))) $(p).remove(); });
  $('a[href*="action=edit"]').each((_, a) => { const box = $(a).closest('p, div, li'); (box.length ? box : $(a)).remove(); });
  $('.messagebox').each((_, e) => { if ($(e).hasClass('stub')) g.stub = true; $(e).remove(); });
  $('.mw-heading').each((_, e) => { $(e).replaceWith($(e).children('h1,h2,h3,h4,h5,h6')); });
  $('span.mw-headline').each((_, e) => { $(e).replaceWith($(e).html()); });

  // Quest details: the wiki's table becomes a card; its marker icon goes.
  $('table.quest-infobox').each((_, t) => {
    const rows = [];
    $(t).find('tr').each((__, tr) => {
      const k = text($(tr).find('.quest-infobox-title').text());
      const v = $(tr).find('td.quest-infobox-row').not('.quest-infobox-icon').first();
      // Required items become a checklist: one tick per top-level line.
      if (/^required items$/i.test(k)) {
        const used = new Set();
        v.children('ul, ol').children('li').each((___, li) => { $(li).addClass('need').attr('data-need', stableId(text($(li).text()), used)); });
        g.items = v.find('li.need').length;
      }
      if (k && v.length && text(v.text())) rows.push([k, v.html()]);
    });
    g.details = Object.fromEntries(rows.map(([k, v]) => [k, text(cheerio.load(v, null, false).root().text())]));
    $(t).replaceWith(`<div class="qd">${rows.map(([k, v]) => `<div class="qd-row"><div class="qd-k">${esc(k)}</div><div class="qd-v">${v}</div></div>`).join('')}</div>`);
  });


  // Galleries become a grid of figures.
  $('ul.gallery').each((_, ul) => {
    const items = $(ul).find('li.gallerybox').toArray().map(li => {
      const img = $(li).find('img').first();
      const pic = img.closest('a.mw-file-description').length ? img.closest('a.mw-file-description') : img;
      const cap = $(li).find('.gallerytext').html() || '';
      return img.length ? `<figure class="gfig">${$.html(pic)}${text(cheerio.load(cap, null, false).root().text()) ? `<figcaption>${cap}</figcaption>` : ''}</figure>` : '';
    });
    $(ul).replaceWith(`<div class="gallery">${items.join('')}</div>`);
  });

  // Videos are tens of MB, so they stay on the wiki: a still that opens the clip there.
  for (const v of $('video').toArray()) {
    const src = $(v).attr('src') || $(v).find('source').attr('src');
    const poster = $(v).attr('poster');
    const file = src && fileFromSrc(src);
    if (!file) { $(v).remove(); continue; }
    const pl = poster ? await picture(file + '-poster', 0, 640, WIKI + poster.split('?')[0]) : null;
    const link = $(v).closest('a').length ? $(v).closest('a') : $(v);
    link.replaceWith(`<a class="vid" href="${WIKI}/w/File:${file}" target="_blank" rel="noopener">${pl ? `<img src="../${pl}" alt="" loading="lazy" decoding="async">` : ''}<span>▶ Watch the clip on the wiki</span></a>`);
  }

  // Pictures: saved locally as WebP at twice their shown size; bigger ones open full size.
  for (const im of $('img').toArray()) {
    const $im = $(im);
    if (($im.attr('src') || '').startsWith('../img/')) continue; // already saved (video stills)
    const file = fileFromSrc($im.attr('src') || '');
    if (!file) { $im.remove(); continue; }
    const fileW = +$im.attr('data-file-width') || 0, fileH = +$im.attr('data-file-height') || 0;
    let w = +$im.attr('width') || fileW || 300, h = +$im.attr('height') || (fileW ? Math.round(w * fileH / fileW) : 0);
    if (fileW && w > fileW) w = fileW;
    const src = await picture(file, fileW, Math.min(w * 2, 1600));
    const alt = $im.attr('alt') && !/\.(png|jpe?g|gif|svg|webp)/i.test($im.attr('alt'))
      ? $im.attr('alt') : decodeURIComponent(file).replace(/\.[a-z]+$/i, '').replace(/_/g, ' ');
    const zoom = fileW >= 500 && w >= 120 ? await picture(file, fileW, 1600) : null;
    const tag = `<img src="../${src}" width="${w}"${h ? ` height="${h}"` : ''} alt="${esc(alt)}" loading="lazy" decoding="async">`;
    const link = $im.closest('a');
    if (link.length && link.hasClass('mw-file-description')) link.replaceWith(zoom ? `<a class="zoom" href="../${zoom}">${tag}</a>` : tag);
    else if (link.length && link.closest('.pic-link, .plinkp-template, .inventory-image').length === 0 && zoom && !link.attr('href')?.startsWith('/w/')) link.replaceWith(`<a class="zoom" href="../${zoom}">${tag}</a>`);
    else $im.replaceWith(tag);
  }
  $('span[typeof="mw:File"], span[typeof="mw:File/Frameless"]').each((_, e) => { $(e).replaceWith($(e).html()); });
  $('figure[typeof]').each((_, e) => {
    const f = $(e);
    const cls = f.hasClass('mw-halign-right') ? 'fig right' : f.hasClass('mw-halign-left') ? 'fig left' : 'fig';
    const cap = f.find('figcaption').html();
    f.find('figcaption').remove();
    f.replaceWith(`<figure class="${cls}">${f.html()}${cap && text(cheerio.load(cap, null, false).root().text()) ? `<figcaption>${cap}</figcaption>` : ''}</figure>`);
  });

  // Links: to other guides here when we have them, otherwise to the wiki.
  $('a').each((_, a) => {
    const $a = $(a);
    const href = $a.attr('href') || '';
    if ($a.hasClass('new') || $a.hasClass('mw-selflink') || $a.hasClass('selflink')) { $a.replaceWith($a.html()); return; }
    if ($a.hasClass('zoom')) return;
    if (href.startsWith('/w/')) {
      let [p, h] = href.slice(3).split('#');
      let title = decodeURIComponent(p).replace(/_/g, ' ');
      title = redirects.get(title) || title;
      const target = byTitle.get(title.toLowerCase());
      if (target && target !== g) { $a.attr('href', `../${target.slug}/${h ? '#' + h : ''}`); }
      else if (target === g) { $a.attr('href', h ? '#' + h : '#top'); }
      else { $a.attr('href', WIKI + href); $a.attr('target', '_blank'); $a.attr('rel', 'noopener'); $a.addClass('wl'); }
    } else if (href.startsWith('//')) {
      $a.attr('href', 'https:' + href); $a.attr('target', '_blank'); $a.attr('rel', 'noopener');
    } else if (href.startsWith('/')) {
      $a.attr('href', WIKI + href); $a.attr('target', '_blank'); $a.attr('rel', 'noopener');
    } else if (/^https?:/.test(href)) {
      $a.attr('target', '_blank'); $a.attr('rel', 'noopener');
    }
    $a.removeAttr('title');
    const keep = ['wl', 'zoom', 'vid'].filter(c => $a.hasClass(c));
    if (keep.length) $a.attr('class', keep.join(' ')); else $a.removeAttr('class');
  });

  // Maps (after the links, so the pop-ups link the same way).
  const maps = [];
  for (const el of $('.map').toArray()) {
    const data = JSON.parse($(el).attr('data-json') || '{}');
    const popups = $(el).find('.map-popup').toArray().map(p => $(p).children('span').toArray().map(s => $(s).html() || ''));
    const markers = [];
    (data.markers || []).forEach((m, i) => {
      if (!m.position || !onMap(m.position)) return;
      const [title, desc] = popups[i] || [esc(m.popup?.title || ''), esc(m.popup?.description || '')];
      markers.push({ x: m.position[0], y: m.position[1], t: title, d: desc, icon: m.icon || null });
    });
    if (g.penguins) { $(el).replaceWith('<p class="mapnote">The penguin spots are on the <a href="' + PENGUINS + '">KGP Field Guide</a> map, with a found-it checklist.</p>'); continue; }
    if (!markers.length) { $(el).replaceWith(`<p class="mapnote">This map is off the world map (Scorned Wilderness). <a href="${WIKI}/w/${encodeURIComponent(g.wikiTitle.replace(/ /g, '_'))}">See it on the wiki</a>.</p>`); continue; }
    maps.push({ el, markers, zoom: data.zoom, center: data.center });
  }
  for (const m of maps) {
    for (const mk of m.markers) if (mk.icon) mk.icon = await picture(encodeURIComponent(mk.icon.replace(/ /g, '_')), 0, 64).catch(() => null);
    $(m.el).replaceWith(`<div class="qmap" data-map="${esc(JSON.stringify({ markers: m.markers }))}"><noscript>The map needs JavaScript.</noscript></div>`);
  }
  g.hasMap = maps.length > 0;

  // Tidy: no inline styles or wiki classes, except the ones the site styles.
  const KEEP = new Set(['qd', 'qd-row', 'qd-k', 'qd-v', 'qmap', 'gallery', 'gfig', 'fig', 'right', 'left', 'zoom', 'wl', 'mapnote', 'wikitable', 'sortable', 'lighttable', 'checklist', 'buglist', 'keypress', 'inventory-image', 'pic-link', 'table-bg-green', 'table-bg-yellow', 'flexbox-wrapper', 'flexbox-row', 'flexbox-item', 'flexbox-image', 'flexbox-caption', 'vid', 'need']);
  $('*').each((_, e) => {
    const $e = $(e);
    $e.removeAttr('style').removeAttr('bgcolor').removeAttr('align').removeAttr('valign').removeAttr('data-file-width').removeAttr('data-file-height').removeAttr('typeof').removeAttr('lang').removeAttr('dir').removeAttr('role');
    const cls = ($e.attr('class') || '').split(/\s+/).filter(c => KEEP.has(c));
    if (cls.length) $e.attr('class', cls.join(' ')); else $e.removeAttr('class');
  });
  $('table').each((_, t) => { if (!$(t).parent().hasClass('tw')) $(t).wrap('<div class="tw"></div>'); });
  $('p').each((_, p) => { if (!text($(p).text()) && !$(p).find('img,video').length) $(p).remove(); });
  $('br').each((_, b) => { const n = b.next; if (!n || (n.type === 'text' && !n.data.trim() && !n.next)) $(b).remove(); });

  // Sections: fold the long ones, drop the ones that make no sense here.
  const kids = root.contents().toArray();
  const out = [];
  let cur = null;
  for (const k of kids) {
    if (k.type === 'tag' && k.name === 'h2') {
      const name = text($(k).text()).toLowerCase();
      cur = { h: k, name, nodes: [] };
      out.push(cur);
    } else if (cur) cur.nodes.push(k);
    else out.push({ lead: true, nodes: [k] });
  }
  let html = '';
  const toc = [];
  const usedSteps = new Set();
  g.steps = 0;
  for (const s of out) {
    let inner = s.nodes.map(n => $.html(n)).join('');
    if (s.lead) { html += inner; continue; }
    // Walkthrough paragraphs and top-level list lines become steps players can tick off.
    if (/walkthrough/.test(s.name) && !FOLD.has(s.name)) {
      const $s = cheerio.load(inner, null, false);
      $s('p, li').each((_, el) => {
        const $e = $s(el);
        if ($e.closest('table, figure, .gallery, .qd, details, .tw').length || $e.parents('li').length) return;
        const t = text($e.text());
        if (t.length < 30) return;
        $e.addClass('step').attr('data-step', stableId(t, usedSteps));
        g.steps++;
      });
      inner = $s.html();
    }
    if (DROP.has(s.name)) continue;
    const id = $(s.h).attr('id') || slugify(s.name);
    const title = text($(s.h).text());
    if (!text(cheerio.load(inner, null, false).root().text()) && !/<img|<video|qmap/.test(inner)) continue;
    toc.push({ id, title, sub: cheerio.load(inner, null, false)('h3').toArray().map(h => ({ id: h.attribs.id, title: text(cheerio.load(h).text()) })).filter(x => x.id) });
    if (/walkthrough/.test(s.name) && !g.walkId) g.walkId = id;
    if (FOLD.has(s.name)) html += `<details class="sect" id="${esc(id)}"><summary><h2>${esc(title)}</h2></summary>${inner}</details>`;
    else html += `<section><h2 id="${esc(id)}">${esc(title)}</h2>${inner}</section>`;
  }
  g.toc = toc;
  g.html = html.replace(/\n{2,}/g, '\n');
  g.maps = (g.html.match(/class="qmap"/g) || []).length;
  g.minutes = Math.max(1, Math.round(text(cheerio.load(g.html, null, false).root().text()).split(' ').length / 220));

  // Card picture and summary.
  if (!heroImg) {
    const first = cheerio.load(parsed.text)('img').toArray().find(i => (+i.attribs['data-file-width'] || 0) >= 400 && !/icon|marker|stub/i.test(i.attribs.src));
    if (first) heroImg = { file: fileFromSrc(first.attribs.src), w: +first.attribs['data-file-width'] };
  }
  if (heroImg?.file) {
    // Small pictures (item icons) would be blurry as a full-width header; they still make a card.
    if (heroImg.w >= 800) g.hero = await picture(heroImg.file, heroImg.w, 1200);
    g.thumb = await picture(heroImg.file, heroImg.w, 560);
  }
  // No picture on the wiki (yet): a drawn one in the region's colour.
  if (!g.hero || !g.thumb) {
    const art = await placeholderArt(g);
    g.hero = g.hero || art.big;
    g.thumb = g.thumb || art.small;
    if (!heroImg?.file) g.artOnly = true;
  }
  const lead = cheerio.load(g.html, null, false)('p').first().text();
  g.summary = text(g.details?.Description || lead).replace(/\s*\[\d+\]/g, '');
  g.lead = text(lead);
  if (g.summary.length > 220) g.summary = g.summary.slice(0, 217).replace(/\s+\S*$/, '') + '…';
}

// ---------- drawn pictures for guides the wiki has none for ----------
// Contour lines around a marker in the guide's region colour, the same every build.
function seeded(str) {
  let a = parseInt(createHash('sha1').update(str).digest('hex').slice(0, 8), 16);
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const mix = (hex, other, p) => {
  const c = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const [a, b] = [c(hex), c(other)];
  return '#' + a.map((v, i) => Math.round(v * p + b[i] * (1 - p)).toString(16).padStart(2, '0')).join('');
};
async function placeholderArt(g) {
  const W = 1200, H = 675;
  const rnd = seeded(g.slug);
  const col = regionColor(g.regions[0]);
  const ring = (cx, cy, r, ph1, ph2) => {
    const pts = [];
    for (let i = 0; i < 72; i++) {
      const t = (i / 72) * Math.PI * 2;
      const rr = r * (1 + 0.13 * Math.sin(t * 3 + ph1) + 0.06 * Math.sin(t * 5 + ph2));
      pts.push(`${(cx + Math.cos(t) * rr * 1.25).toFixed(1)},${(cy + Math.sin(t) * rr).toFixed(1)}`);
    }
    return `M${pts.join('L')}Z`;
  };
  let rings = '';
  for (let c = 0; c < 3; c++) {
    const cx = 120 + rnd() * 960, cy = 80 + rnd() * 520, p1 = rnd() * 6, p2 = rnd() * 6;
    const n = 6 + Math.floor(rnd() * 5);
    for (let k = 1; k <= n; k++) rings += `<path d="${ring(cx, cy, 26 * k + rnd() * 6, p1 + k * 0.08, p2)}" stroke="${mix(col, '#ffffff', 0.55)}" stroke-opacity="${(0.32 - k * 0.022).toFixed(3)}" stroke-width="1.6" fill="none"/>`;
  }
  const ex = W * 0.5, ey = H * 0.5;
  // Main story and side quests: the game's quest marker; activities: a compass.
  const emblem = g.kind === 'activity'
    ? `<g transform="translate(${ex} ${ey})" fill="none" stroke="#fff" stroke-opacity=".75" stroke-width="5" stroke-linejoin="round"><circle r="92" stroke-opacity=".35"/><path d="M0-118 22-22 118 0 22 22 0 118-22 22-118 0-22-22Z" fill="${col}" fill-opacity=".55"/><path d="M0-118 0 118M-118 0 118 0" stroke-opacity=".3" stroke-width="3"/><circle r="12" fill="#fff" fill-opacity=".8" stroke="none"/></g>`
    : `<g transform="translate(${ex} ${ey})" stroke="#fff" stroke-opacity=".8" stroke-width="5" stroke-linejoin="round"><path d="M0-112 92 0 0 112-92 0Z" fill="${col}" fill-opacity=".55"/><path d="M0-82 64 0 0 82-64 0Z" fill="none" stroke-opacity=".35" stroke-width="3"/><rect x="-9" y="-56" width="18" height="70" rx="9" fill="#fff" fill-opacity=".9" stroke="none"/><circle cy="38" r="11" fill="#fff" fill-opacity=".9" stroke="none"/></g>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${mix(col, '#17120c', 0.5)}"/><stop offset="1" stop-color="#0f0c08"/></linearGradient>
<radialGradient id="glow" cx=".5" cy=".5" r=".55"><stop offset="0" stop-color="${col}" stop-opacity=".55"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></radialGradient>
<pattern id="dots" width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.3" fill="#fff" fill-opacity=".09"/></pattern>
</defs>
<rect width="${W}" height="${H}" fill="url(#bg)"/>
<rect width="${W}" height="${H}" fill="url(#dots)"/>
${rings}
<ellipse cx="${ex}" cy="${ey}" rx="330" ry="260" fill="url(#glow)"/>
${emblem}
</svg>`;
  mkdirSync(imgDir, { recursive: true });
  const out = {};
  for (const [key, w] of [['big', 1200], ['small', 560]]) {
    const name = `art-${g.slug}-${w}.webp`;
    usedImages.add(name);
    await sharp(Buffer.from(svg)).resize({ width: w }).webp({ quality: 82 }).toFile(path.join(imgDir, name));
    out[key] = 'img/' + name;
  }
  return out;
}

// ---------- page templates ----------
const KIND = { primary: 'Main story', secondary: 'Side quest', activity: 'Activity' };
const KIND_PLURAL = { primary: 'Main story quests', secondary: 'Side quests', activity: 'Activities' };
const regionColor = r => REGIONS[r] || '#5b6876';

function head({ title, description, url, image, depth, leaflet }) {
  const up = depth ? '../' : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${url}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${url}">
${image ? `<meta property="og:image" content="${SITE}${image}">\n<meta name="twitter:card" content="summary_large_image">\n` : ''}<meta name="theme-color" content="#101114">
<link rel="icon" type="image/png" href="${up}img/icons/journal.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@700;800&family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;1,400&family=IBM+Plex+Mono:wght@400;500&display=swap">
${leaflet ? '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css">\n' : ''}<link rel="stylesheet" href="${up}style.css">
</head>`;
}
// The bar shared by the three Dragonwilds sites (the same markup is in the penguin map and
// the mod's site; keep them in step).
function suite(up) {
  return `<nav class="suite" aria-label="Dragonwilds tools">
  <div class="suite-in">
    <a class="st st-q" href="${up || './'}" aria-current="page"><span class="st-ico" aria-hidden="true"><img src="${up}img/icons/journal.png" alt="" width="48" height="48"></span><span class="st-t"><b><span class="st-l">Quest guides</span><span class="st-s">Quests</span></b><small>Every quest, step by step</small></span></a>
    <a class="st st-p" href="${PENGUINS}"><span class="st-ico" aria-hidden="true"><img src="${up}img/icons/penguin-coin.png" alt="" width="48" height="48"></span><span class="st-t"><b><span class="st-l">Penguin map</span><span class="st-s">Penguins</span></b><small>All 208 KGP spots</small></span></a>
    <a class="st st-m" href="${MOD}"><span class="st-ico" aria-hidden="true"><img src="${up}img/icons/lodestone.png" alt="" width="48" height="48"></span><span class="st-t"><b><span class="st-l">Server mod</span><span class="st-s">Server mod</span></b><small>Discord bot for your server</small></span></a>
  </div>
</nav>`;
}
function topbar(up) {
  return `<header class="topbar">
  <a class="brand" href="${up || './'}"><img class="mark" src="${up || ''}img/icons/journal.png" alt="" width="48" height="48"><span><b>Dragonwilds Quest Guides</b><small>Every quest &amp; activity</small></span></a>
  <a class="coffee" href="${KOFI}" target="_blank" rel="noopener" aria-label="Support me on Ko-fi" data-goatcounter-click="ko-fi" data-goatcounter-title="Ko-fi button"><svg class="cup" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V8z" fill="currentColor"/><path d="M17 10h1.5a2.5 2.5 0 0 1 0 5H17" fill="none" stroke="currentColor" stroke-width="2"/><path d="M10.5 16.4s-3.1-1.9-3.1-3.9a1.6 1.6 0 0 1 3.1-.7 1.6 1.6 0 0 1 3.1.7c0 2-3.1 3.9-3.1 3.9z" fill="#ff5e5b"/></svg><span>Support me on Ko-fi</span></a>
</header>
${modBanner(up || '')}`;
}
// A quiet line under the header for players who'd like to host their own server. Hidden for
// good once closed; the inline script decides before the page draws, so nothing jumps.
function modBanner(up) {
  return `<aside class="modbar" id="modbar" aria-label="Hosting your own server" hidden>
  <div class="modbar-in">
    <img class="modbar-ico" src="${up}img/icons/lodestone.png" alt="" width="48" height="48">
    <p>Want to host a Dragonwilds server for your friends? <a href="${MOD}">Here's a step-by-step setup guide for beginners</a>.</p>
    <button type="button" class="modbar-x" id="modbarClose" aria-label="Hide this">×</button>
  </div>
</aside>
<script>(function () { var b = document.getElementById('modbar'); try { if (localStorage.getItem('dq-modbar-closed-v1')) { b.remove(); return; } } catch (e) {} b.hidden = false; })();</script>`;
}
function footer(up) {
  return `<footer class="foot">
  <div class="foot-in">
    <p><b>Dragonwilds Quest Guides</b> is a free fan site. Guides, maps and pictures come from the <a href="${WIKI}/" target="_blank" rel="noopener">RuneScape: Dragonwilds Wiki</a> and its editors, under <a href="https://creativecommons.org/licenses/by-nc-sa/3.0/" target="_blank" rel="noopener">CC BY-NC-SA 3.0</a>. Spotted a mistake? Fix it on the wiki and it shows up here at the next rebuild.</p>
    <p><i>RuneScape: Dragonwilds</i> and its art © Jagex Ltd. Not affiliated with Jagex. Visits are counted with GoatCounter: no cookies, nothing personal.</p>
    <p class="foot-links"><a href="${PENGUINS}">Penguin map</a> · <a href="${MOD}">Server mod &amp; Discord bot</a> · <a href="${REPO}" target="_blank" rel="noopener">Source</a> · <a href="${KOFI}" target="_blank" rel="noopener" data-goatcounter-click="ko-fi" data-goatcounter-title="Ko-fi button">Support me on Ko-fi</a></p>
  </div>
</footer>
<script>window.goatcounter = { path: '/quest-guides', title: 'Quest guides' };</script>
<script data-goatcounter="https://kgpguide.goatcounter.com/count" async src="https://gc.zgo.at/count.js"></script>`;
}
const regionChip = r => `<span class="rchip" style="--rc:${regionColor(r)}">${esc(r)}</span>`;
function ribbons(g) {
  if (!g.released && !g.updated) return '';
  return `<span class="ribbons">${g.released ? `<span class="ribbon new" data-new="${g.released}" hidden>New</span>` : ''}${g.updated ? `<span class="ribbon upd" data-new="${g.updated.date}" hidden title="${esc(g.updated.note)}">Updated</span>` : ''}</span>`;
}
function card(g) {
  return `<li class="card" data-slug="${g.slug}" data-kind="${g.kind}" data-steps="${g.steps || 0}" data-regions="${esc(g.regions.join('|'))}" data-search="${esc((g.title + ' ' + g.regions.join(' ') + ' ' + (g.saga || '') + ' ' + g.summary + ' ' + (g.details?.['Start Point'] || '')).toLowerCase())}">
  <a href="${g.slug}/">
    <div class="card-img">${g.thumb ? `<img src="${g.thumb}" alt="" loading="lazy" decoding="async">` : `<span class="card-ph" aria-hidden="true"></span>`}${ribbons(g)}<span class="tick" aria-label="Done" hidden>✓</span><span class="cprog" hidden><i></i></span></div>
    <div class="card-body">
      <h3>${esc(g.title)}</h3>
      <div class="card-meta">${g.regions.map(regionChip).join('')}${g.kind === 'primary' && g.saga ? `<span class="saga">${esc(g.saga)}</span>` : ''}${g.stub ? '<span class="stubtag" title="The wiki marks this page as unfinished">Short guide</span>' : ''}</div>
      <p class="cstat" hidden></p>
      <p>${esc(g.summary)}</p>
    </div>
  </a>
</li>`;
}

function indexPage(guides, latest) {
  const by = k => guides.filter(g => g.kind === k).sort((a, b) => a.order - b.order);
  const primary = by('primary'), secondary = by('secondary'), acts = by('activity');
  const regionsSecondary = REGION_ORDER.filter(r => secondary.some(g => g.regions.includes(r)));
  const latestGuides = guides.filter(g => g.released === latest || g.updated?.date === latest);
  const quests = primary.length + secondary.length;
  const desc = `Step-by-step guides for all ${quests} quests in RuneScape: Dragonwilds, plus ${acts.length} activities: where to start, what to bring, maps, pictures and rewards. Tick off what you've done.`;
  return `${head({ title: 'Dragonwilds Quest Guides · every quest and activity', description: desc, url: SITE, image: primary.find(g => g.hero)?.hero, depth: 0 })}
<body>
${suite('')}
${topbar('')}
<main id="top">
  <section class="hero">
    <div class="hero-in">
      <p class="eyebrow">RuneScape: Dragonwilds · ${quests} quests · ${acts.length} activities</p>
      <h1>Every quest guide, in one place</h1>
      <p class="lede">Where to start, what to bring, every step, with maps and pictures. Tick quests off as you go: your progress stays in this browser.</p>
      <div class="search">
        <input type="search" id="q" placeholder="Search quests, places, people…" aria-label="Search the guides" autocomplete="off">
      </div>
      <div class="progress" id="progress" hidden><div class="bar"><span id="bar"></span></div><span id="ptext"></span></div>
      <p class="nextup" id="nextup" hidden></p>
    </div>
  </section>

  <section class="continue" id="continue" hidden>
    <div class="wrap">
      <h2 class="sec-title"><img class="sec-ico" src="img/icons/scroll.png" alt="" width="48" height="48" aria-hidden="true"> Pick up where you left off</h2>
      <ul class="cards" id="contCards"></ul>
    </div>
  </section>

  ${latestGuides.length ? `<section class="latest" id="latest">
    <div class="wrap">
      <h2 class="sec-title"><img class="sec-ico" src="img/icons/primary.png" alt="" width="48" height="48" aria-hidden="true"> New in the latest update <small>${niceDate(latest)}</small></h2>
      <ul class="cards">${latestGuides.map(card).join('')}</ul>
    </div>
  </section>` : ''}

  <div class="wrap">
    <div class="filters" id="filters">
      <div class="seg" role="group" aria-label="Show">
        <button type="button" data-kind="all" aria-pressed="true">All</button>
        <button type="button" data-kind="primary" aria-pressed="false">Main story</button>
        <button type="button" data-kind="secondary" aria-pressed="false">Side quests</button>
        <button type="button" data-kind="activity" aria-pressed="false">Activities</button>
      </div>
      <select id="region" aria-label="Region"><option value="">Every region</option>${REGION_ORDER.filter(r => guides.some(g => g.regions.includes(r))).map(r => `<option>${esc(r)}</option>`).join('')}</select>
      <label class="toggle"><input type="checkbox" id="hideDone"> Hide done</label>
      <span class="count" id="count"></span>
    </div>

    <section class="group" id="primary" data-group="primary">
      <h2 class="sec-title"><img class="sec-ico" src="img/icons/primary.png" alt="" width="48" height="48" aria-hidden="true"> Main story <small>Play these in order</small></h2>
      <ol class="cards story">${primary.map(card).join('')}</ol>
    </section>

    <section class="group" id="secondary" data-group="secondary">
      <h2 class="sec-title"><img class="sec-ico" src="img/icons/secondary.png" alt="" width="48" height="48" aria-hidden="true"> Side quests <small>By region</small></h2>
      ${regionsSecondary.map(r => `<div class="region" data-region="${esc(r)}">
        <h3 class="region-title" style="--rc:${regionColor(r)}">${esc(r)}</h3>
        <ul class="cards">${secondary.filter(g => g.regions.includes(r)).map(card).join('')}</ul>
      </div>`).join('')}
    </section>

    <section class="group" id="activity" data-group="activity">
      <h2 class="sec-title"><img class="sec-ico" src="img/icons/chest.png" alt="" width="48" height="48" aria-hidden="true"> Activities <small>Trails, challenges and hunts</small></h2>
      <ul class="cards">${acts.map(card).join('')}</ul>
    </section>

    <p class="empty" id="empty" hidden>No guide matches that. <button type="button" class="linkbtn" id="clear">Show everything</button></p>

    <aside class="promos">
      <a class="promo penguin" href="${PENGUINS}">
        <img class="promo-ico" src="img/icons/penguin-coin.png" alt="" width="48" height="48" aria-hidden="true">
        <span><b>Hunting penguins?</b> All 208 Killer Gentoo Penguin spots on an interactive map, with a found-it checklist.</span>
        <span class="promo-go">Open the map →</span>
      </a>
      <a class="promo mod" href="${MOD}">
        <img class="promo-ico" src="img/icons/lodestone.png" alt="" width="48" height="48" aria-hidden="true">
        <span><b>Run your own server?</b> A free server mod and Discord bot: live chat, quest and death feeds, leaderboards, admin tools.</span>
        <span class="promo-go">See what it does →</span>
      </a>
    </aside>
  </div>
</main>
${footer('')}
<script src="site.js"></script>
</body>
</html>
`;
}

function guidePage(g, prev, next) {
  const url = `${SITE}${g.slug}/`;
  const kindLabel = g.kind === 'primary' ? (g.saga === 'Tutorial' ? 'Main story · Tutorial' : `Main story${g.saga ? ' · ' + g.saga : ''}`) : KIND[g.kind];
  const desc = `${g.title} ${g.kind === 'activity' ? 'guide' : 'quest guide'} for RuneScape: Dragonwilds. ${g.summary}`.slice(0, 300);
  const wikiUrl = `${WIKI}/w/${encodeURIComponent(g.wikiTitle.replace(/ /g, '_'))}`;
  const toc = g.toc.length > 1 ? `<nav class="toc" aria-label="On this page"><p>On this page</p><ol>${g.toc.map(t => `<li><a href="#${esc(t.id)}">${esc(t.title)}</a>${t.sub.length ? `<ol>${t.sub.map(s => `<li><a href="#${esc(s.id)}">${esc(s.title)}</a></li>`).join('')}</ol>` : ''}</li>`).join('')}</ol></nav>` : '';
  return `${head({ title: `${g.title} · ${g.kind === 'activity' ? 'Dragonwilds activity guide' : 'Dragonwilds quest guide'}`, description: desc, url, image: g.hero, depth: 1, leaflet: g.hasMap })}
<body class="guide-page" data-slug="${g.slug}">
${suite('../')}
${topbar('../')}
<main id="top">
  <header class="ghero${g.hero ? '' : ' plain'}">
    ${g.hero ? `<img class="ghero-bg" src="../${g.hero}" alt="" decoding="async">` : ''}
    <div class="ghero-in">
      <nav class="crumbs" aria-label="Breadcrumb"><a href="../">All guides</a> <span aria-hidden="true">›</span> <a href="../#${g.kind}">${KIND_PLURAL[g.kind]}</a>${g.regions[0] && g.kind === 'secondary' ? ` <span aria-hidden="true">›</span> <a href="../?region=${encodeURIComponent(g.regions[0])}">${esc(g.regions[0])}</a>` : ''}</nav>
      <div class="gtags"><span class="kind">${esc(kindLabel)}</span>${g.regions.map(regionChip).join('')}${ribbons(g)}</div>
      <h1>${esc(g.title)}</h1>
      ${g.details?.Description ? `<p class="gdesc">${esc(g.details.Description)}</p>` : ''}
      <ul class="gstats">${[
        g.steps ? `<li><b>${g.steps}</b> steps</li>` : '',
        g.items ? `<li><b>${g.items}</b> ${g.items === 1 ? 'item' : 'items'} to bring</li>` : '',
        g.maps ? `<li><b>${g.maps}</b> ${g.maps === 1 ? 'map' : 'maps'}</li>` : '',
        `<li><b>${g.minutes}</b> min read</li>`,
      ].join('')}</ul>
      <div class="gactions">
        ${g.steps ? `<a class="start-btn" id="startBtn" href="#${esc(g.walkId || 'top')}"><span aria-hidden="true">▶</span> <span class="lbl">Start the walkthrough</span></a>` : ''}
        <button type="button" class="done-btn" id="doneBtn" aria-pressed="false"><span class="box" aria-hidden="true"></span><span class="lbl">Mark as done</span></button>
        ${g.released ? `<span class="rel">Released ${niceDate(g.released)}</span>` : ''}
      </div>
    </div>
  </header>

  <div class="gwrap">
    ${toc ? `<aside class="side">${toc}</aside>` : ''}
    <article class="content${toc ? '' : ' wide'}">
      ${g.updated ? `<p class="notice upd"><b>Updated ${niceDate(g.updated.date)}:</b> ${esc(g.updated.note)}.</p>` : ''}
      ${g.penguins ? `<a class="cta" href="${PENGUINS}"><img class="cta-ico" src="../img/icons/penguin-coin.png" alt="" width="48" height="48" aria-hidden="true"><span><b>Open the penguin map</b> All 208 spots, filters and a found-it checklist</span><span aria-hidden="true">→</span></a>` : ''}
      ${g.stub ? `<p class="notice stub">The wiki is still filling in this guide, so it may be short or missing steps. You can <a href="${wikiUrl}" target="_blank" rel="noopener">add what you know there</a>.</p>` : ''}
      ${g.html}
      <nav class="pn" aria-label="More guides">
        ${prev ? `<a class="pn-prev" href="../${prev.slug}/"><small>${g.kind === 'primary' ? 'Previous in the story' : 'Previous'}</small><span>${esc(prev.title)}</span></a>` : '<span></span>'}
        ${next ? `<a class="pn-next" href="../${next.slug}/"><small>${g.kind === 'primary' ? 'Next in the story' : 'Next'}</small><span>${esc(next.title)}</span></a>` : '<span></span>'}
      </nav>
      <p class="source">This guide is the wiki's <a href="${wikiUrl}" target="_blank" rel="noopener">${esc(g.wikiTitle)}</a> article, by <a href="${wikiUrl}?action=history" target="_blank" rel="noopener">its editors</a>, reformatted for this site. Licensed <a href="https://creativecommons.org/licenses/by-nc-sa/3.0/" target="_blank" rel="noopener">CC BY-NC-SA 3.0</a>.</p>
    </article>
  </div>
  <aside class="wrap promos slim">
    <a class="promo mod" href="${MOD}">
      <img class="promo-ico" src="../img/icons/lodestone.png" alt="" width="48" height="48" aria-hidden="true">
      <span><b>Playing on your own server?</b> Get a Discord bot that posts quest completions, deaths and chat, with leaderboards and admin tools.</span>
      <span class="promo-go">Take a look →</span>
    </a>
  </aside>
</main>
<div class="lightbox" id="lightbox" hidden><img alt=""><button type="button" aria-label="Close">×</button></div>
${footer('../')}
${g.hasMap ? '<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>\n' : ''}<script src="../site.js"></script>
</body>
</html>
`;
}

// ---------- build ----------
mkdirSync(imgDir, { recursive: true });
const guides = await guideList();
const byTitle = new Map();
for (const g of guides) { byTitle.set(g.page.toLowerCase(), g); byTitle.set(g.title.toLowerCase(), g); }
for (const g of guides) { const p = await parsePage(g.page); byTitle.set(p.title.toLowerCase(), g); }

// Wiki links that go through a redirect, so links to guides we have stay on this site.
const redirectTitles = new Set();
for (const g of guides) {
  const $ = cheerio.load((await parsePage(g.page)).text, null, false);
  $('a.mw-redirect').each((_, a) => { const h = $(a).attr('href') || ''; if (h.startsWith('/w/')) redirectTitles.add(decodeURIComponent(h.slice(3).split('#')[0]).replace(/_/g, ' ')); });
}
const redirects = new Map(Object.entries(await cached('redirects.json', async () => {
  const map = {};
  const list = [...redirectTitles];
  for (let i = 0; i < list.length; i += 50) {
    const j = await get(`${API}?action=query&format=json&formatversion=2&redirects=1&titles=${encodeURIComponent(list.slice(i, i + 50).join('|'))}`);
    for (const r of j.query.redirects || []) map[r.from] = r.to;
    await sleep(300);
  }
  return map;
})));

for (const g of guides) {
  process.stdout.write(`${g.title} … `);
  await buildGuide(g, byTitle, redirects);
  console.log(`${g.html.length} chars${g.hasMap ? ', map' : ''}${g.stub ? ', stub' : ''}`);
}

const latest = guides.map(g => g.updated?.date || g.released).filter(Boolean).sort().pop();
// Folders from an earlier build whose guide is gone.
const slugs = new Set(guides.map(g => g.slug));
for (const d of readdirSync(ROOT)) {
  if (!slugs.has(d) && existsSync(path.join(ROOT, d, '.guide'))) rmSync(path.join(ROOT, d), { recursive: true });
}
for (const kind of ['primary', 'secondary', 'activity']) {
  const list = guides.filter(g => g.kind === kind).sort((a, b) => a.order - b.order);
  list.forEach((g, i) => {
    mkdirSync(path.join(ROOT, g.slug), { recursive: true });
    writeFileSync(path.join(ROOT, g.slug, 'index.html'), guidePage(g, list[i - 1], list[i + 1]));
    writeFileSync(path.join(ROOT, g.slug, '.guide'), g.page + '\n');
  });
}
writeFileSync(path.join(ROOT, 'index.html'), indexPage(guides, latest));
writeFileSync(path.join(ROOT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>${SITE}</loc></url>
${guides.map(g => `<url><loc>${SITE}${g.slug}/</loc></url>`).join('\n')}
</urlset>
`);
writeFileSync(path.join(ROOT, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${SITE}sitemap.xml\n`);
writeFileSync(path.join(ROOT, 'guides.json'), JSON.stringify(guides.map(g => ({
  slug: g.slug, title: g.title, kind: g.kind, regions: g.regions, saga: g.saga || null, released: g.released || null,
  updated: g.updated || null, wiki: g.wikiTitle, revid: g.revid, stub: !!g.stub,
})), null, 1) + '\n');

// Pictures no page uses any more.
let removed = 0;
for (const f of readdirSync(imgDir)) if (!usedImages.has(f) && statSync(path.join(imgDir, f)).isFile()) { rmSync(path.join(imgDir, f)); removed++; }
const size = readdirSync(imgDir).reduce((n, f) => { const st = statSync(path.join(imgDir, f)); return n + (st.isFile() ? st.size : 0); }, 0);
console.log(`\n${guides.length} guides, ${usedImages.size} pictures (${(size / 1e6).toFixed(1)} MB)${removed ? `, removed ${removed} old` : ''}. Latest update: ${latest}.`);
