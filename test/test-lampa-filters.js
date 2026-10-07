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
  const env = { fixtures, storage, listeners, reliseCalls: [], requests: [], refreshed: 0, stack: [{ component: 'main' }], settingsCreated: null, headAction: null };
  const jQuery = function () {
    return { append: () => {}, on: () => {}, parent: () => ({ length: 1 }), detach: () => {}, remove: () => {}, children: () => ({ last: () => ({}) }), hasClass: () => false };
  };
  const Lampa = {
    Storage: storage,
    SettingsApi: { addComponent: () => {} },
    Settings: { listener: { follow: () => {} }, create: (name, params) => { env.settingsCreated = name; env.settingsParams = params; } },
    Favorite: { get: () => fixtures.slice() },
    Select: { show: () => {} },
    Listener: { follow: (name, cb) => { (listeners[name] = listeners[name] || []).push(cb); } },
    Controller: { add: () => {}, toggle: () => {}, back: () => {}, collectionSet: () => {}, collectionFocus: () => {} },
    Activity: { active: () => env.stack[env.stack.length - 1], all: () => env.stack, refresh: () => { env.refreshed++; } },
    Head: { render: () => ({ length: 1 }), addIcon: (icon, action) => { env.headAction = action; } },
    TMDB: { key: () => 'testkey', api: (u) => 'https://test.example/3/' + u },
    Reguest: function () {
      return { silent: (url, ok) => { env.requests.push({ url: url, ok: ok }); }, clear: () => {}, timeout: () => {} };
    },
    Api: {
      relise: (params, cb) => {
        env.reliseCalls.push(params.page);
        const page = params.page;
        cb(page <= 5
          ? { results: [{ title: 'p' + page + 'a' }, { title: 'p' + page + 'b' }], page: page, total_pages: 5 }
          : { results: [], page: page, total_pages: 5 });
      }
    }
  };
  global.window = global;
  global.Lampa = Lampa;
  global.$ = jQuery;
  global.jQuery = jQuery;
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
  check('favorites filtered by own rules (rating >= 8, экранка теперь проходит)', fav.map(r => r.title).join(',') === 'Курьер,Экранка,Персона,Старый-2017');
}

{
  const env = makeEnv({ lampa_filters: { enabled: true, auto_off_hours: 0, enabled_at: 0, rating_min: 7, quality: ['4k', 'webdl', 'bdrip'], year_from: 2018, year_to: null, exclude_genres: [27], favorites: { enabled: false } } });
  loadPlugin();

  const out = deliver(env, 'https://apitmdb.cubnotrip.top/3/discover/movie?page=1');
  check('year range drops 2017 item', out.results.map(r => r.title).join(',') === 'Курьер,Персона');

  const fav = env.Lampa.Favorite.get();
  check('favorites off: everything stays', fav.length === env.fixtures.length);
}

{
  const env = makeEnv({});
  loadPlugin();

  let result = null;
  env.Lampa.Api.relise({ page: 1 }, (data) => { result = data; });
  check('relise accumulates until upstream end (5 pages x 2 = 10)', result.results.length === 10 && env.reliseCalls.length === 5);

  env.reliseCalls.length = 0;
  env.Lampa.Api.relise({ page: 2 }, (data) => { result = data; });
  check('relise next displayed page resumes after consumed upstream', env.reliseCalls[0] === 6 && result.results.length === 0);
}

{
  const env = makeEnv({ lampa_filters: { enabled: true, auto_off_hours: 0, enabled_at: 0, rating_min: 0, quality: [], year_from: 2018, year_to: null, exclude_genres: [27], favorites: { enabled: true, rating_min: 0, quality: [], exclude_genres: [27], include_genres: [], keep_unknown_quality: true } } });
  env.fixtures.push({ title: 'Астрал', vote_average: 6.9, id: 555, release_date: '2018-06-01' });
  loadPlugin();

  let fav = env.Lampa.Favorite.get();
  check('астрал без жанров: остаётся до уточнения', fav.some(r => r.title === 'Астрал') && env.requests.length === 1 && /movie\/555/.test(env.requests[0].url));

  env.requests[0].ok({ genres: [{ id: 27, name: 'ужасы' }] });
  check('жанры уточнены и закэшированы', env.storage.dump().lampa_filters_genres['555'][0] === 27);
  check('экран обновился после уточнения', env.refreshed > 0);

  fav = env.Lampa.Favorite.get();
  check('астрал отсеян по жанру из кэша', !fav.some(r => r.title === 'Астрал'));
}

{
  const base = { enabled: true, auto_off_hours: 0, enabled_at: 0, rating_min: 0, rating_source: 'auto', year_from: null, year_to: null, quality: [], keep_unknown_quality: true, include_genres: [], exclude_genres: [] };

  const env = makeEnv({ lampa_filters: Object.assign({}, base, { exclude_genres: [27], filter_cam: true, favorites: Object.assign({}, base.favorites || {}, { enabled: false }) }) });
  loadPlugin();
  const out = deliver(env, 'https://apitmdb.cubnotrip.top/3/discover/movie?page=1');
  check('исключающий [27] + filter_cam=true: хоррор и экранка скрыты', !out.results.some(r => r.title === 'Хоррор') && !out.results.some(r => r.title === 'Экранка') && out.results.length === env.fixtures.length - 2);
}

{
  const base = { enabled: true, auto_off_hours: 0, enabled_at: 0, rating_min: 0, rating_source: 'auto', year_from: null, year_to: null, quality: [], keep_unknown_quality: true, include_genres: [], exclude_genres: [] };

  const env = makeEnv({ lampa_filters: Object.assign({}, base, { include_genres: [35], favorites: Object.assign({}, base.favorites || {}, { enabled: false }) }) });
  loadPlugin();
  const out = deliver(env, 'https://apitmdb.cubnotrip.top/3/discover/movie?page=1');
  check('включающий [35]: только комедии и не-контент', out.results.map(r => r.title).join(',') === 'Курьер,Новинка-без-голосов,Персона');
}

{
  const base = { enabled: true, auto_off_hours: 0, enabled_at: 0, rating_min: 0, rating_source: 'auto', year_from: null, year_to: null, quality: [], keep_unknown_quality: true, include_genres: [], exclude_genres: [] };

  const env = makeEnv({ lampa_filters: Object.assign({}, base, { include_genres: [53], exclude_genres: [27], favorites: Object.assign({}, base.favorites || {}, { enabled: false }) }) });
  env.fixtures.push({ title: 'Чистый-триллер', vote_average: 8.0, vote_count: 10, genre_ids: [53], release_date: '2026-01-01' });
  loadPlugin();
  const out = deliver(env, 'https://apitmdb.cubnotrip.top/3/discover/movie?page=1');
  check('комбо include [53] + exclude [27]: хоррор (27,53) скрыт, чистый триллер остался', out.results.map(r => r.title).join(',') === 'Персона,Чистый-триллер');
}

{
  const base = { enabled: true, auto_off_hours: 0, enabled_at: 0, rating_min: 0, rating_source: 'auto', year_from: null, year_to: null, quality: [], keep_unknown_quality: true, include_genres: [], exclude_genres: [] };

  const env = makeEnv({ lampa_filters: Object.assign({}, base, { exclude_genres: [27], favorites: Object.assign({}, base.favorites || {}, { enabled: false }) }) });
  env.fixtures.push({ name: 'Сериал-хоррор', first_air_date: '2026-02-02', vote_average: 8.0, vote_count: 30, genre_ids: [18, 27] });
  env.fixtures.push({ title: 'Из-детали', release_date: '2026-03-03', vote_average: 8.0, vote_count: 30, genres: [{ id: 27, name: 'ужасы' }] });
  loadPlugin();
  const out = deliver(env, 'https://tmdb.cubnotrip.top/?sort=top');
  check('исключающий [27]: ТВ-карточка и жанры-объекты тоже отсеиваются', !out.results.some(r => r.name === 'Сериал-хоррор') && !out.results.some(r => r.title === 'Из-детали'));
}

{
  const base = { enabled: true, auto_off_hours: 0, enabled_at: 0, rating_min: 0, rating_source: 'auto', year_from: null, year_to: null, quality: [], keep_unknown_quality: true, include_genres: [], exclude_genres: [] };

  const env = makeEnv({ lampa_filters: Object.assign({}, base, { filter_cam: false, favorites: Object.assign({}, base.favorites || {}, { enabled: false }) }) });
  loadPlugin();
  const out = deliver(env, 'https://apitmdb.cubnotrip.top/3/discover/movie?page=1');
  check('экранка по умолчанию (filter_cam=false): показывается, стоковое поведение', out.results.some(r => r.title === 'Экранка') && out.results.length === env.fixtures.length);
}

{
  const env = makeEnv({});
  loadPlugin();

  env.stack = [{ component: 'main' }];
  env.settingsCreated = null;
  env.headAction();
  check('шапка на обычном экране: открывается глобальный фильтр', env.settingsCreated === 'lampa_filters');

  env.stack = [{ component: 'favorite' }];
  env.settingsCreated = null;
  env.headAction();
  check('шапка на избранном: открывается фильтр избранного', env.settingsCreated === 'lampa_filters_favorites');

  env.stack = [{ component: 'favorite' }, { component: 'full' }];
  env.settingsCreated = null;
  env.headAction();
  check('шапка на карточке из избранного: открывается фильтр избранного', env.settingsCreated === 'lampa_filters_favorites');

  env.stack = [{ component: 'main' }, { component: 'category_full' }, { component: 'full' }];
  env.settingsCreated = null;
  env.headAction();
  check('шапка на карточке из каталога: открывается глобальный фильтр', env.settingsCreated === 'lampa_filters');
}

console.log('\nитог: ' + passed + ' проверок пройдено');
