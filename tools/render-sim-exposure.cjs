// Render sim for the Max Clicks exposure section (analysis 22 PLAN-part-a-build.md Tasks 4-6).
// Runs the page's real <script> in a fresh vm context per scenario with stubbed document / Chart / fetch,
// fed by saved CSVs (tools/fixture-main.csv + fixture-exposure-*.csv). Usage: node tools/render-sim-exposure.cjs
const fs = require('fs'); const path = require('path'); const vm = require('vm'); const assert = require('assert/strict');
const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)[1];
const fx = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
const FIX = { main: fx('fixture-main.csv'), weekly: fx('fixture-exposure-weekly.csv'), keywords: fx('fixture-exposure-keywords.csv'), devices: fx('fixture-exposure-devices.csv') };
const NODE_CFG = path.join(ROOT, '..', '..', 'clients', 'cable-bullet', 'analysis', '18-weekly_sheet_autofill-22102026', 'lib', 'exposure-config.mjs');

let pass = 0, fail = 0;
async function check(name, fn) { try { await fn(); pass++; console.log('  PASS  ' + name); } catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message.split('\n')[0]); } }

// Run the page once. tabs: { weekly, keywords, devices } CSV text, null = that fetch rejects,
// 'HANG' = that fetch never settles. opts.throwChart = canvas id whose Chart constructor throws.
// Timers under 1 s run at once; longer ones (fetch timeouts) never fire, like a slow network.
function runPage(tabs, opts = {}) {
  const charts = {}; const els = {}; const alerts = [];
  // Like the DOM, setting textContent replaces the children (populateStats clears a row with textContent='').
  const make = (id) => {
    const o = { id, _text: '', value: '0', innerHTML: '', className: '', style: {}, children: [], dataset: {},
      classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, toggle(c, on) { if (on === undefined ? !this._s.has(c) : on) this._s.add(c); else this._s.delete(c); }, contains(c) { return this._s.has(c); } },
      appendChild(c) { this.children.push(c); return c; }, replaceChildren() { this.children = []; }, addEventListener() {}, setAttribute(k, v) { this[k] = v; }, getAttribute(k) { return this[k]; }, querySelectorAll() { return []; }, getContext() { return {}; } };
    Object.defineProperty(o, 'textContent', { get() { return this._text; }, set(v) { this._text = String(v); this.children = []; }, enumerable: true });
    return o;
  };
  const el = (id) => (els[id] ||= make(id));
  let n = 0;
  const ctx = {
    document: { getElementById: el, createElement: (t) => { const e = el('__' + t + (n++)); e.tagName = t; return e; }, createTextNode: (t) => ({ nodeValue: t }) },
    Chart: function (canvas, cfg) { if (opts.throwChart && canvas.id === opts.throwChart) throw new Error('boom'); charts[canvas.id] = cfg; this.destroy = () => {}; this.resize = () => {}; this.setDatasetVisibility = () => {}; this.update = () => {}; this.isDatasetVisible = () => true; },
    fetch: (url) => {
      const m = String(url).match(/[?&]sheet=([^&]+)/);
      if (!m) return Promise.resolve({ ok: true, text: () => Promise.resolve(FIX.main) });
      const name = decodeURIComponent(m[1]);
      const key = { 'MaxClicks Weekly': 'weekly', 'MaxClicks Keywords': 'keywords', 'MaxClicks Devices': 'devices' }[name];
      const body = tabs[key];
      if (body === 'HANG') return new Promise(() => {});
      return body === null ? Promise.reject(new Error('network')) : Promise.resolve({ ok: true, text: () => Promise.resolve(body) });
    },
    alert: (m) => { alerts.push(m); }, setTimeout: (f, ms) => { if (!ms || ms < 1000) f(); return 0; }, clearTimeout: () => {}, innerWidth: 1440, console, Promise, Date, Math, JSON, encodeURIComponent, decodeURIComponent, isFinite, parseFloat, parseInt, Number, String, Array, Object, Map, Set,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(script, ctx);
  return new Promise((res) => setTimeout(() => res({ ctx, charts, els, alerts, d: ctx.allData }), 50));
}
const dropLast = (csv) => csv.trim().split(/\r?\n/).slice(0, -1).join('\n');
const lines = (csv) => csv.trim().split(/\r?\n/);

(async () => {
  const cfg = fs.existsSync(NODE_CFG) ? await import('file:///' + NODE_CFG.replace(/\\/g, '/')) : null;

  console.log('\nTask 4: data layer');
  await check('page constants match the Node writer config', async () => {
    if (!cfg) { console.log('        (skipped: writer config not present)'); return; }
    const { ctx } = await runPage(FIX);
    assert.deepEqual(JSON.parse(JSON.stringify(ctx.EXPO_TABS)), cfg.TABS);
    assert.deepEqual(JSON.parse(JSON.stringify(ctx.EXPO_HEADERS)), { weekly: cfg.WEEKLY_HEADERS, keywords: cfg.KEYWORD_HEADERS, devices: cfg.DEVICE_HEADERS });
    assert.equal(ctx.MC_LEADS_FROM, cfg.LEADS_FROM);
    assert.equal(ctx.MC_KW_BASIS, cfg.KW_CONV_BASIS);
  });
  await check('aligns by trimmed label and leaves missing weeks null', async () => {
    const L = lines(FIX.weekly);
    L[L.length - 2] = L[L.length - 2].replace(/^"([^"]+)"/, '"$1 "');   // trailing space on the 2nd newest label
    const { d } = await runPage({ ...FIX, weekly: dropLast(L.join('\n')) });
    assert.equal(d.mcStatus, 'ok');
    assert.equal(d.mc.is.length, d.fullDates.length);
    const iNew = d.fullDates.indexOf('10/18/26 - 10/24/26'), iPrev = d.fullDates.indexOf('10/11/26 - 10/17/26');
    assert.ok(iNew > 0 && iPrev > 0, 'fixture weeks present in main tab');
    assert.equal(d.mc.is[iNew], null);
    assert.equal(typeof d.mc.is[iPrev], 'number');
    assert.equal(d.mc.is[d.fullDates.indexOf('06/28/26 - 07/04/26')], null, 'weeks before the tabs start are null');
    assert.equal(d.mcKw.length, d.fullDates.length);
    assert.ok(d.mcKw[iPrev].length > 0 && d.mcDev[iPrev].length === 3);
  });
  await check('weightedShare skips zero and blank shares', async () => {
    const { ctx } = await runPage(FIX);
    assert.equal(ctx.weightedShare([0.7, null, 0], [1000, 500, 0]), 0.7);
    assert.equal(ctx.weightedShare([null], [10]), null);
  });
  await check('costPer uses partner-present weeks only', async () => {
    const { ctx } = await runPage(FIX);
    assert.equal(ctx.costPer([100, 200, 300], [null, 2, 0]), 250);
    assert.equal(ctx.costPer([100], [0]), null);
  });
  await check('header drift shows banner and keeps other charts', async () => {
    const L = lines(FIX.weekly); L[0] = L[0].replace('"search is","search top is"', '"search top is","search is"');
    const { d, charts, els } = await runPage({ ...FIX, weekly: L.join('\n') });
    assert.equal(d.mcStatus, 'drift');
    assert.match(els['mc-banner'].textContent, /being updated/);
    for (const c of ['metaChart', 'gadsChart', 'revenueChart', 'leadChart']) assert.ok(charts[c], c + ' built');
  });
  await check('the week picker slices the Max Clicks arrays too', async () => {
    const { ctx, els } = await runPage(FIX);
    const n = ctx.allData.fullDates.length;
    els.dateFrom.value = String(n - 3); els.dateTo.value = String(n - 2);
    let built = null; const real = ctx.buildDashboard; ctx.buildDashboard = (f) => { built = f; };
    ctx.applyFilter(); ctx.buildDashboard = real;
    assert.equal(built.mc.is.length, 2);
    assert.equal(built.mcKw.length, 2);
    assert.equal(built.mc.is[1], ctx.allData.mc.is[n - 2]);
  });
  await check('exposure fetch failure keeps the rest', async () => {
    const { d, charts } = await runPage({ ...FIX, weekly: null });
    assert.equal(d.mcStatus, 'unavailable');
    for (const c of ['metaChart', 'gadsChart', 'revenueChart', 'leadChart']) assert.ok(charts[c], c + ' built');
  });

  console.log('\nTask 5: section UI');
  const statOf = (els, id, label) => { const it = els[id].children.find((c) => c.children[0] && c.children[0].textContent === label); return it ? it.children[1].textContent : undefined; };
  await check('tiles show the latest week with data and name it', async () => {
    const { d, els, ctx } = await runPage({ ...FIX, weekly: dropLast(FIX.weekly) });
    const iPrev = d.fullDates.indexOf('10/11/26 - 10/17/26');
    assert.equal(els['mc-tile-is'].textContent, (d.mc.is[iPrev] * 100).toFixed(0) + '%');
    assert.match(els['mc-tiles-week'].textContent, /11 to 17 Oct/);
    assert.match(els['mc-tiles-week'].textContent, /still being added/);
    assert.match(els['mc-tile-is-ch'].textContent, /points/);
    assert.ok(ctx);
  });
  await check('range tiles are weighted, not averaged', async () => {
    const { d, els, ctx } = await runPage(FIX);
    const w = d.mc.impr.map((v, i) => (d.mc.is[i] === null ? null : v));
    const want = ctx.weightedShare(d.mc.is, w);
    assert.equal(els['mc-tile-is-range'].textContent.split(': ')[1], ctx.mcPct(want));
  });
  await check('results row is sum over sum', async () => {
    const { d, els, ctx } = await runPage(FIX);
    assert.equal(statOf(els, 'mc-results', 'Cost per lead'), ctx.mcMoney(ctx.costPer(d.mc.spend, d.mc.leads)));
    const v = d.mc.value.reduce((a, x) => a + (x || 0), 0), s = d.mc.spend.reduce((a, x) => a + (x || 0), 0);
    assert.equal(statOf(els, 'mc-results', 'Return (ROAS): $ back per $1').split(' ')[0], (v / s).toFixed(2) + 'x');
  });
  await check('toggle arrays match datasets', async () => {
    const { charts, els } = await runPage(FIX);
    for (const [c, t] of [['mcShareChart', 'toggles-mc-share'], ['mcTrafficChart', 'toggles-mc-traffic'], ['mcResultsChart', 'toggles-mc-results']]) {
      assert.ok(charts[c], c + ' built');
      assert.equal(els[t].children.length, charts[c].data.datasets.length, c);
    }
  });
  await check('no NaN or Infinity in the section text', async () => {
    const { els } = await runPage(FIX);
    const bad = Object.values(els).filter((e) => /^mc-|^__/.test(e.id) && /NaN|Infinity|undefined/.test(String(e.textContent)));
    assert.equal(bad.length, 0, bad.map((e) => e.id + '=' + e.textContent).join(', '));
  });
  await check('charts start at the first week with Max Clicks data', async () => {
    const { d, charts } = await runPage(FIX);
    const first = d.labels[d.mc.spend.findIndex((v) => v !== null)];
    for (const c of ['mcShareChart', 'mcLostChart', 'mcTrafficChart', 'mcResultsChart']) {
      assert.equal(charts[c].data.labels[0], first, c);
      assert.equal(charts[c].data.datasets[0].data.length, charts[c].data.labels.length, c);
    }
  });
  await check('empty range shows the no-data message', async () => {
    const { ctx, els, charts } = await runPage(FIX);
    for (const k of Object.keys(charts)) if (/^mc/.test(k)) delete charts[k];
    els.dateFrom.value = '0'; els.dateTo.value = '1';
    ctx.applyFilter();
    assert.match(els['mc-banner'].textContent, /no data in the weeks selected/);
    assert.equal(Object.keys(charts).filter((k) => /^mc/.test(k)).length, 0);
  });

  console.log('\nTask 6: keyword table + device chart');
  const rowsOf = (els) => els['mc-kw-body'].children.map((tr) => tr.children.map((td) => td.textContent));
  await check('keyword table aggregates across weeks', async () => {
    const { d, els, ctx } = await runPage(FIX);
    const all = [].concat(...d.mcKw);
    const k = all.filter((r) => r.kw === 'cable railing for decks' && r.mt === 'phrase');
    assert.ok(k.length >= 2, 'keyword in 2+ weeks');
    const clicks = k.reduce((a, r) => a + r.clicks, 0);
    const shown = ctx.weightedShare(k.map((r) => r.is), k.map((r) => r.impr));
    const row = rowsOf(els).find((r) => r[0] === 'cable railing for decks' && r[1] === 'phrase');
    assert.ok(row, 'row present');
    assert.equal(row[5], ctx.fmt(clicks));
    assert.equal(row[2], ctx.mcPct(shown));
  });
  await check('keyword table caps at 10 rows', async () => {
    const { els } = await runPage(FIX);
    assert.equal(els['mc-kw-body'].children.length, 10);
  });
  await check('keyword table sorts by a column on header click', async () => {
    const { els, ctx } = await runPage(FIX);
    ctx.mcSortKw(2);
    const v = rowsOf(els).map((r) => parseFloat(r[2]));
    assert.deepEqual(v, [...v].sort((a, b) => b - a));
  });
  await check('keyword leads header names the basis', async () => {
    const { els, ctx } = await runPage(FIX);
    assert.equal(els['mc-kw-leads-h'].textContent, 'Leads');
    ctx.MC_KW_BASIS = 'click_date'; ctx.buildDashboard(ctx.allData);
    assert.equal(els['mc-kw-leads-h'].textContent, 'Leads (click date)');
  });
  await check('device chart has 3 categories in order Phone, Desktop, Tablet', async () => {
    const { charts } = await runPage(FIX);
    assert.deepEqual([...charts.mcDevChart.data.labels], ['Phone', 'Desktop', 'Tablet']);
    assert.equal(charts.mcDevChart.data.datasets.length, 2);
  });

  console.log('\n/check-deep fixes');
  const OLD = ['metaChart', 'gadsChart', 'revenueChart', 'leadChart'];
  await check('a stuck tab download never blocks the page', async () => {
    const { els, charts, d, alerts } = await runPage({ ...FIX, keywords: 'HANG' });
    assert.ok(els.loadingOverlay.classList.contains('hidden'), 'overlay hidden');
    for (const c of OLD) assert.ok(charts[c], c + ' built');
    assert.equal(d.mcStatus, 'loading');
    assert.equal(alerts.length, 0);
  });
  await check('a drawing error in the section keeps the rest and shows a banner', async () => {
    const { els, charts, alerts } = await runPage(FIX, { throwChart: 'mcShareChart' });
    for (const c of OLD) assert.ok(charts[c], c + ' built');
    assert.ok(els['lead-stats'].children.length > 0, 'lead stats filled');
    assert.match(els['mc-banner'].textContent, /could not be shown/);
    assert.equal(alerts.length, 0);
  });
  await check('keyword cost per lead counts only weeks with lead data', async () => {
    const { d, els, ctx } = await runPage(FIX);
    const all = [].concat(...d.mcKw).filter((r) => r.kw === 'cable handrail' && r.mt === 'phrase');
    const leads = all.reduce((a, r) => a + (r.leads || 0), 0), cost = all.filter((r) => r.leads !== null).reduce((a, r) => a + r.cost, 0);
    const row = rowsOf(els).find((r) => r[0] === 'cable handrail' && r[1] === 'phrase');
    assert.equal(row[9], ctx.mcMoney(cost / leads));
  });
  await check('clamped shares read as <10% and >90%', async () => {
    const { ctx } = await runPage(FIX);
    assert.equal(ctx.mcPct(0.0999), '<10%');
    assert.equal(ctx.mcPct(0.9001), '>90%');
    assert.equal(ctx.mcPct(0.65), '65%');
  });
  await check('traffic and results labels name the real period', async () => {
    const { els } = await runPage(FIX);
    assert.match(els['mc-period-traffic'].textContent, /26 Jul to 24 Oct \(13 weeks\)/);
    assert.match(els['mc-tile-is-range'].textContent, /^Average 26 Jul to 24 Oct: \d+%$/);
  });
  await check('spend per day uses the latest week against the daily budget', async () => {
    const { d, els, ctx } = await runPage(FIX);
    const li = ctx.latestIdx(d.mc.spend);
    assert.equal(statOf(els, 'mc-traffic', 'Spend per day (latest week)'), ctx.mcMoney(d.mc.spend[li] / 7) + ' of ' + ctx.mcMoney(2900) + ' budget');
  });
  await check('missed-searches chart shows one stack and switches to first ad', async () => {
    const { charts, els, ctx } = await runPage(FIX);
    const ds = charts.mcLostChart.data.datasets;
    assert.equal(ds.length, 6);
    assert.equal(JSON.stringify(ds.map((x) => !!x.hidden)), JSON.stringify([false, false, false, true, true, true]));
    assert.equal(els['toggles-mc-lost'].children.length, 2);
    assert.equal(typeof ctx.mcLostMode, 'function');
  });
  await check('header share clears on an empty range', async () => {
    const { ctx, els } = await runPage(FIX);
    assert.match(els['mc-head-share'].textContent, /%/);
    els.dateFrom.value = '0'; els.dateTo.value = '1'; ctx.applyFilter();
    assert.equal(els['mc-head-share'].textContent, '');
  });
  await check('a missing tab reads as unavailable, not as a layout change', async () => {
    const { d, els } = await runPage({ ...FIX, devices: FIX.main });
    assert.equal(d.mcStatus, 'unavailable');
    assert.doesNotMatch(els['mc-banner'].textContent, /layout/);
  });
  await check('counts that round to a whole number print without a decimal', async () => {
    const { ctx } = await runPage(FIX);
    assert.equal(ctx.mcNum(18.99999), '19');
    assert.equal(ctx.mcNum(16.55), '16.6');
  });
  await check('a tiny change prints no minus zero', async () => {
    const { ctx } = await runPage(FIX);
    assert.equal(ctx.mcDelta(0.65, 0.6502), '0.0 points vs');
  });
  await check('main data link is pinned to the first tab and tab links ask for 1 header row', async () => {
    const { ctx } = await runPage(FIX);
    assert.match(ctx.CSV_URL, /[?&]gid=0\b/);
    assert.match(ctx.EXPO_URL('MaxClicks Weekly'), /headers=1/);
    assert.doesNotMatch(ctx.EXPO_URL('MaxClicks Weekly'), /gid=/);
  });

  console.log('\npass-2 fixes');
  await check('week names use day and month', async () => {
    const { els } = await runPage(FIX);
    assert.match(els['mc-tiles-week'].textContent, /^Week of 18 to 24 Oct$/);
    assert.match(els['mc-tile-is-ch'].textContent, /vs 11 to 17 Oct$/);
  });
  await check('a zero change has no colour', async () => {
    const L = lines(FIX.weekly);
    const prev = L[L.length - 2].split('","'), last = L[L.length - 1].split('","');
    last[4] = prev[4]; L[L.length - 1] = last.join('","');
    const { els } = await runPage({ ...FIX, weekly: L.join('\n') });
    assert.equal(els['mc-tile-is-ch'].className, 'kpi-change');
  });
  await check('missed-chart mode buttons report the pressed state', async () => {
    const { els, ctx } = await runPage(FIX);
    ctx.mcLostMode('abs');
    const b = els['toggles-mc-lost'].children;
    assert.equal(b[0].getAttribute('aria-pressed'), 'false');
    assert.equal(b[1].getAttribute('aria-pressed'), 'true');
  });
  await check('budget only shows when the view ends at the newest week', async () => {
    const { ctx, els } = await runPage(FIX);
    assert.match(statOf(els, 'mc-traffic', 'Spend per day (latest week)'), /budget/);
    const n = ctx.allData.fullDates.length;
    els.dateFrom.value = String(n - 4); els.dateTo.value = String(n - 2); ctx.applyFilter();
    assert.doesNotMatch(statOf(els, 'mc-traffic', 'Spend per day (latest week)'), /budget/);
  });
  await check('section follows the last applied range when tabs arrive late', async () => {
    const { ctx, els } = await runPage(FIX);
    const n = ctx.allData.fullDates.length;
    els.dateFrom.value = String(n - 3); els.dateTo.value = String(n - 2); ctx.applyFilter();
    els.dateFrom.value = String(n - 1); els.dateTo.value = String(n - 3); ctx.applyFilter();   // invalid: From after To
    const v = ctx.currentView();
    assert.equal(v.fullDates.length, 2);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
