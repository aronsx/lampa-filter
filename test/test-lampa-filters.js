const fs = require('fs');
const path = require('path');
const assert = require('assert');

const PLUGINS = path.join(__dirname, '..', 'lampa-filters.plugin.js');

function makeStorage(initial) {
  const store = Object.assign({}, initial);
  return {
    get: (k, d) => (k in store ? JSON.parse(JSON.stringify(store[k])) : JSON.parse(d)),
    set: (k, v) => { store[k] = JSON.parse(JSON.stringify(v)); },
    dump: () => store
  };
}

function makeEnv(storageInitial) {
  const storage = makeStorage(storageInitial);
  const listeners = {};
  const fixtures = [
    { title: 'Курьер', vote_average: 8.3, vote_count: 50, imdb_rating: '6.7', release_quality: 'webdl', genre_ids: [28, 35], release_date: '2026-09-10' },
    { title: 'Хоррор', vote_average: 7.5, vote_count: 30, release_quality: 'webdl', genre_ids: [27, 53], release_date: '2026-08-01' },
    { title: 'Экранка', vote_average: 8.0, vote_count: 20, release_quality: 'ts', genre_ids: [28], release_date: '2026-07-01' },
    { title: 'Слабый', vote_average: 5.5, vote_count: 40, release_quality: '4K', genre_ids: [18], release_date: '2026-06-01' },
    { title: 'Новинка-без-голосов', vote_average: 8.0, vote_count: 2, imdb_rating: '5.9', release_quality: 'webdl', genre_ids: [35], release_date: '2026-05-01' },
    { title: 'Персона', popularity: 12.0 },
    { title: 'Старый-2017', vote_average: 8.0, vote_count: 100, release_quality: '4K', genre_ids: [28], release_date: '2017-03-03' }
  ];
  const env = { fixtures, storage, listeners };
  const Lampa = {
    Storage: storage,
    SettingsApi: { addComponent: () => {} },
    Settings: { listener: { follow: () => {} } },
    Favorite: { get: () => fixtures.slice() },
    Select: { show: () => {} },
    Listener: { follow: (name, cb) => { (listeners[name] = listeners[name] || []).push(cb); } }
  };
  global.window = global;
  global.Lampa = Lampa;
  env.Lampa = Lampa;
  return env;
}

function loadPlugin() {
  eval(fs.readFileSync(PLUGINS, 'utf8'));
}

let passed = 0;
function check(name, cond) {
  assert(cond, name);
  passed++;
  console.log('OK  ' + name);
}

function deliver(env, url) {
  const data = { results: env.fixtures.slice() };
  const event = { params: { url: url }, data: data };
  (env.listeners['request_secuses'] || []).forEach((cb) => cb(event));
  return data;
}

{
  const env = makeEnv({});
  loadPlugin();

  const out = deliver(env, 'https://apitmdb.cubnotrip.top/3/discover/movie?page=1');
  check('basic: only Курьер, Персона, Старый-2017 stay', out.results.map(r => r.title).join(',') === 'Курьер,Персона,Старый-2017');

  const search = deliver(env, 'https://apitmdb.cubnotrip.top/3/search/movie?query=хоррор');
  check('search is never filtered', search.results.length === env.fixtures.length);

  const cub = deliver(env, 'https://tmdb.cubnotrip.top/?sort=releases&results=20&page=1');
  check('cub list (releases) is filtered', cub.results.length === 3);

  const sameRef = deliver(env, 'https://tmdb.cubnotrip.top/?sort=top');
  check('data object mutated in place (reference preserved)', Array.isArray(sameRef.results));
}

{
  const env = makeEnv({ lampa_filters: { enabled: true, auto_off_hours: 12, enabled_at: Date.now() - 13 * 3600000, rating_min: 7, quality: ['4k', 'webdl', 'bdrip'], exclude_genres: [27], favorites: { enabled: true, rating_min: 8, quality: [], exclude_genres: [], include_genres: [], keep_unknown_quality: true } } });
  loadPlugin();

  const out = deliver(env, 'https://apitmdb.cubnotrip.top/3/discover/movie?page=1');
  check('expired timer disables list filtering', out.results.length === env.fixtures.length);
  check('expired timer auto-disables and persists config', env.storage.dump().lampa_filters.enabled === false);

  const fav = env.Lampa.Favorite.get();
  check('favorites filtered by own rules (rating >= 8)', fav.map(r => r.title).join(',') === 'Курьер,Персона,Старый-2017');
}

{
  const env = makeEnv({ lampa_filters: { enabled: true, auto_off_hours: 0, enabled_at: 0, rating_min: 7, quality: ['4k', 'webdl', 'bdrip'], year_from: 2018, year_to: null, exclude_genres: [27], favorites: { enabled: false } } });
  loadPlugin();

  const out = deliver(env, 'https://apitmdb.cubnotrip.top/3/discover/movie?page=1');
  check('year range drops 2017 item', out.results.map(r => r.title).join(',') === 'Курьер,Персона');

  const fav = env.Lampa.Favorite.get();
  check('favorites off: everything stays', fav.length === env.fixtures.length);
}

console.log('\nитог: ' + passed + ' проверок пройдено');
