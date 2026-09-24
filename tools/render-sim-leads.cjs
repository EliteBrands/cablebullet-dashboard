// Render sim for the Lead Quality card. Stubs document/Chart/fetch, evals the page's
// real <script> against a CSV, and asserts the lead card. Usage:
//   node tools/render-sim-leads.cjs [tools/fixture-leads.csv]
const fs = require('fs'); const path = require('path'); const assert = require('assert/strict');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)[1];
const csv = fs.readFileSync(process.argv[2] || path.join(__dirname, 'fixture-leads.csv'), 'utf8');
const charts = {}; const els = {};
const el = (id) => (els[id] ||= { id, textContent: '', value: '0', innerHTML: '', className: '', classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, appendChild() {}, addEventListener() {}, setAttribute() {}, style: {} });
// The page's inline script is the LAST <script> (line 116) and ends with a bare loadData() call (line 479).
global.document = { getElementById: el, createElement: () => el('x' + Math.random()), createTextNode: (t) => ({ nodeValue: t }) };
global.Chart = function (canvas, cfg) { charts[canvas.id] = cfg; this.destroy = () => {}; this.resize = () => {}; this.setDatasetVisibility = () => {}; this.update = () => {}; this.isDatasetVisible = () => true; };
global.window = global; global.setTimeout = (f) => f();
global.fetch = () => Promise.resolve({ ok: true, text: () => Promise.resolve(csv) });
eval(script + '\n;global.__allData=()=>allData;');
setImmediate(() => {
  const d = global.__allData();
  assert.deepEqual(d.leadQl, [null, 10, 0, null], 'blank must be null, 0 must stay 0');
  const cfg = charts.leadChart; assert.ok(cfg, 'leadChart built');
  const ds = Object.fromEntries(cfg.data.datasets.map((x) => [x.label, x.data]));
  assert.deepEqual(ds['Cost per QL (Google)'], [null, 600, null, null]);
  assert.deepEqual(ds['Cost per QL (capture-corrected)'], [null, 360, null, null]);
  assert.deepEqual(ds['Client goal $334/QL'], [334, 334, 334, 334]);
  const stats = els['lead-stats']; assert.ok(stats, 'lead stats rendered');
  // sum over sum across weeks WITH QL: (6000+5000) / (10+0) = 1100
  assert.equal(global.__leadTiles.cpql, 1100);
  // Filter sweep: every (from,to) pair builds without throwing.
  for (let a = 0; a < d.fullDates.length; a++) for (let b = a; b < d.fullDates.length; b++) { el('dateFrom').value = String(a); el('dateTo').value = String(b); applyFilter(); }
  console.log('render-sim-leads: PASS');
});
