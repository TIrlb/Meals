/**
 * Mealio Dealio API — Google Apps Script bound to the "Meals" spreadsheet.
 *
 * Tabs: Recipes (the recipe book), Weeks (one row per planned week), Lunch (school
 * lunch mains by date, filled by the monthly transcription task), Settings (key/value).
 *
 * Deploy as a web app: Execute as "Me", Who has access "Anyone".
 * Run setup() once from the editor first; it logs the TOKEN and installs the flyer trigger.
 *
 * GET  ?action=state&token=...
 * POST {token, action: saveWeek|upsertRecipe|setActive|setSettings, ...}
 *      (sent as text/plain so the browser skips the CORS preflight)
 */

const PROPS = PropertiesService.getScriptProperties();

// Drive folder the flyer images are copied into. The lunch transcription task reads from here.
const DEFAULT_FLYER_FOLDER = '1mdHJDogem5HaIzw94BUGBounlRJH_NPH';

const CATEGORIES = ['Pizza Night', 'Mexican', 'Asian', 'Soups', 'Grillin', 'Italian', 'General'];

function setup() {
  if (!PROPS.getProperty('TOKEN')) PROPS.setProperty('TOKEN', Utilities.getUuid().replace(/-/g, ''));
  if (!PROPS.getProperty('FLYER_FOLDER_ID')) PROPS.setProperty('FLYER_FOLDER_ID', DEFAULT_FLYER_FOLDER);
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'grabFlyer') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('grabFlyer').timeBased().everyDays(1).atHour(5).create();
  DriveApp.getFolderById(PROPS.getProperty('FLYER_FOLDER_ID'));   // authorize Drive
  UrlFetchApp.getRequest('https://example.com');                   // authorize UrlFetch
  Logger.log('TOKEN: ' + PROPS.getProperty('TOKEN'));
  Logger.log('Next: set FAMDASH_API and FAMDASH_TOKEN in Project Settings → Script properties, then run grabFlyer once.');
}

/* ---------- plumbing ---------- */

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
function checkToken_(t) {
  if (!t || t !== PROPS.getProperty('TOKEN')) throw new Error('bad token');
}
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { return fn(); } finally { lock.releaseLock(); }
}
function sheet_(name) {
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) throw new Error('missing tab ' + name);
  return sh;
}
// Rows as objects keyed by header, so columns can be reordered or added in the sheet.
function rows_(name) {
  const v = sheet_(name).getDataRange().getValues();
  const head = v.shift().map(String);
  return v.map(function (r, i) {
    const o = { _row: i + 2 };
    head.forEach(function (h, j) { if (h) o[h] = r[j]; });
    return o;
  });
}
function headers_(name) {
  const sh = sheet_(name);
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
}
function bool_(v) { return v === true || String(v).toUpperCase() === 'TRUE'; }
function ymd_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return String(v || '').trim();
}
function slug_(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

/* ---------- GET ---------- */

function doGet(e) {
  try {
    const p = e.parameter || {};
    checkToken_(p.token);
    if (p.action === 'state') return json_({ ok: true, state: state_() });
    return json_({ ok: false, error: 'unknown action' });
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

function state_() {
  return {
    recipes: recipes_(),
    settings: settings_(),
    weeks: rows_('Weeks').filter(function (w) { return w.weekStart; }).map(function (w) {
      let days = [];
      try { days = JSON.parse(w.days || '[]'); } catch (e) {}
      return { weekStart: ymd_(w.weekStart), days: days, updated: w.updated ? String(w.updated) : '' };
    }).sort(function (a, b) { return a.weekStart < b.weekStart ? 1 : -1; }).slice(0, 12),
    lunch: lunch_()
  };
}

function recipes_() {
  const sh = sheet_('Recipes');
  const head = headers_('Recipes');
  const idCol = head.indexOf('id') + 1;
  return rows_('Recipes').filter(function (r) { return String(r.name || '').trim(); }).map(function (r) {
    let id = String(r.id || '').trim();
    if (!id && idCol) {   // a row typed straight into the sheet: give it an id
      id = slug_(r.name) + '-' + Utilities.getUuid().slice(0, 4);
      sh.getRange(r._row, idCol).setValue(id);
    }
    return {
      id: id,
      name: String(r.name).trim(),
      category: CATEGORIES.indexOf(String(r.category)) >= 0 ? String(r.category) : 'General',
      crockpot: bool_(r.crockpot),
      active: r.active === '' ? true : bool_(r.active),
      ingredients: String(r.ingredients || '').split(/\n|;/).map(function (s) { return s.trim(); }).filter(String),
      source: String(r.source || ''),
      url: String(r.url || ''),
      notes: String(r.notes || '')
    };
  });
}

function settings_() {
  const out = {};
  rows_('Settings').forEach(function (r) {
    if (!r.key) return;
    try { out[r.key] = JSON.parse(r.value); } catch (e) { out[r.key] = r.value; }
  });
  return out;
}

// School lunch mains from two weeks back through two months ahead.
function lunch_() {
  const from = ymd_(new Date(Date.now() - 14 * 86400000));
  const to = ymd_(new Date(Date.now() + 62 * 86400000));
  return rows_('Lunch').map(function (r) { return { date: ymd_(r.date), main: String(r.main || '').trim() }; })
    .filter(function (r) { return r.main && r.date >= from && r.date <= to; });
}

/* ---------- POST ---------- */

function doPost(e) {
  try {
    const b = JSON.parse(e.postData.contents);
    checkToken_(b.token);
    return withLock_(function () {
      switch (b.action) {
        case 'saveWeek': return json_({ ok: true, week: saveWeek_(b.weekStart, b.days) });
        case 'upsertRecipe': return json_({ ok: true, recipe: upsertRecipe_(b.recipe) });
        case 'setActive': setField_(b.id, 'active', !!b.active); return json_({ ok: true });
        case 'setSettings': return json_({ ok: true, settings: setSettings_(b.settings || {}) });
        default: return json_({ ok: false, error: 'unknown action' });
      }
    });
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

function saveWeek_(weekStart, days) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart) || !Array.isArray(days)) throw new Error('bad week');
  const clean = days.slice(0, 7).map(function (d) {
    return {
      recipeId: d && d.recipeId ? String(d.recipeId) : '',
      name: d && d.name ? String(d.name).slice(0, 120) : '',
      held: !!(d && d.held),
      crockpot: !!(d && d.crockpot)
    };
  });
  const sh = sheet_('Weeks');
  const now = new Date();
  const hit = rows_('Weeks').filter(function (w) { return ymd_(w.weekStart) === weekStart; })[0];
  const row = [weekStart, JSON.stringify(clean), now];
  if (hit) sh.getRange(hit._row, 1, 1, 3).setValues([row]);
  else sh.appendRow(row);
  return { weekStart: weekStart, days: clean, updated: String(now) };
}

function upsertRecipe_(r) {
  if (!r || !String(r.name || '').trim()) throw new Error('name required');
  const head = headers_('Recipes');
  const sh = sheet_('Recipes');
  const id = String(r.id || '').trim() || slug_(r.name) + '-' + Utilities.getUuid().slice(0, 4);
  const vals = {
    id: id,
    name: String(r.name).trim().slice(0, 120),
    category: CATEGORIES.indexOf(r.category) >= 0 ? r.category : 'General',
    crockpot: !!r.crockpot,
    active: r.active !== false,
    ingredients: (Array.isArray(r.ingredients) ? r.ingredients : String(r.ingredients || '').split(/\n|;/))
      .map(function (s) { return String(s).trim(); }).filter(String).join('\n'),
    source: r.source || 'family',
    url: /^https?:\/\//.test(r.url || '') ? r.url : '',
    notes: String(r.notes || '').slice(0, 1000)
  };
  const hit = rows_('Recipes').filter(function (x) { return String(x.id) === id; })[0];
  const row = head.map(function (h) { return h in vals ? vals[h] : (hit ? hit[h] : ''); });
  if (hit) sh.getRange(hit._row, 1, 1, row.length).setValues([row]);
  else sh.appendRow(row);
  return recipes_().filter(function (x) { return x.id === id; })[0];
}

function setField_(id, field, value) {
  const col = headers_('Recipes').indexOf(field) + 1;
  const hit = rows_('Recipes').filter(function (x) { return String(x.id) === String(id); })[0];
  if (!col || !hit) throw new Error('recipe not found');
  sheet_('Recipes').getRange(hit._row, col).setValue(value);
}

const SETTING_KEYS = ['weekStart', 'defaults', 'lockDays', 'crockpotDays', 'favorites'];
function setSettings_(n) {
  const sh = sheet_('Settings');
  const existing = rows_('Settings');
  SETTING_KEYS.forEach(function (k) {
    if (!(k in n)) return;
    const v = JSON.stringify(n[k]);
    const hit = existing.filter(function (r) { return r.key === k; })[0];
    if (hit) sh.getRange(hit._row, 2).setValue(v);
    else sh.appendRow([k, v]);
  });
  return settings_();
}

/* ---------- school lunch flyer ---------- */

/**
 * Daily trigger. Asks FamDash's backend which lunch flyer is current (it already knows how to
 * find it despite the school site's bot wall), and when that changes, copies the image into the
 * "Meals Lunch Flyers" Drive folder. A scheduled Claude task reads new flyers from that folder
 * and writes each school day's main into the Lunch tab.
 * Script properties: FAMDASH_API (FamDash /exec URL), FAMDASH_TOKEN; or LUNCH_IMAGE_URL to
 * point at an image directly.
 */
function grabFlyer() {
  let url = '', name = '';
  const api = PROPS.getProperty('FAMDASH_API');
  if (api) {
    const res = UrlFetchApp.fetch(api + '?action=lunch&token=' + encodeURIComponent(PROPS.getProperty('FAMDASH_TOKEN') || ''),
      { muteHttpExceptions: true, followRedirects: true });
    const j = JSON.parse(res.getContentText());
    if (!j.ok || !j.url) throw new Error('FamDash lunch: ' + (j.error || 'no url'));
    if (j.stale) Logger.log('FamDash still has last month\'s flyer; will retry tomorrow');
    url = j.url; name = j.name || '';
  } else {
    url = PROPS.getProperty('LUNCH_IMAGE_URL') || '';
    name = decodeURIComponent(url.split('/').pop().split('?')[0]);
  }
  if (!url) throw new Error('set FAMDASH_API/FAMDASH_TOKEN or LUNCH_IMAGE_URL');
  if (url === PROPS.getProperty('FLYER_LAST')) return 'unchanged';
  const img = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
  if (img.getResponseCode() !== 200) throw new Error('flyer fetch ' + img.getResponseCode());
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const blob = img.getBlob().setName(stamp + ' ' + (name || 'lunch flyer'));
  const file = DriveApp.getFolderById(PROPS.getProperty('FLYER_FOLDER_ID') || DEFAULT_FLYER_FOLDER).createFile(blob);
  file.setDescription(url);
  PROPS.setProperty('FLYER_LAST', url);
  Logger.log('Saved ' + file.getName());
  return file.getName();
}
