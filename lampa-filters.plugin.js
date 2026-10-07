(function () {
  'use strict';

  var STORAGE_KEY = 'lampa_filters';
  var VERSION = '2026-10-07.2';
  var CAM_QUALITY = ['ts', 'tc'];
  var QUALITIES = [
    { code: '4k', title: '4K' },
    { code: 'webdl', title: 'webdl' },
    { code: 'bdrip', title: 'bdrip' }
  ];

  var GENRES = [
    { id: 28, title: 'боевик' }, { id: 12, title: 'приключения' }, { id: 16, title: 'мультфильм' },
    { id: 35, title: 'комедия' }, { id: 80, title: 'криминал' }, { id: 99, title: 'документальный' },
    { id: 18, title: 'драма' }, { id: 10751, title: 'семейный' }, { id: 14, title: 'фэнтези' },
    { id: 36, title: 'история' }, { id: 27, title: 'ужасы' }, { id: 10402, title: 'музыка' },
    { id: 9648, title: 'детектив' }, { id: 10749, title: 'мелодрама' }, { id: 878, title: 'фантастика' },
    { id: 10770, title: 'телефильм' }, { id: 53, title: 'триллер' }, { id: 10752, title: 'военный' },
    { id: 37, title: 'вестерн' }
  ];

  var ICON = '<svg><use xlink:href="#sprite-filter"></use></svg>';

  var DEFAULTS = {
    enabled: true,
    auto_off_hours: 12,
    enabled_at: 0,
    rating_min: 7,
    rating_source: 'auto',
    year_from: null,
    year_to: null,
    quality: ['4k', 'webdl', 'bdrip'],
    keep_unknown_quality: true,
    include_genres: [],
    exclude_genres: [27],
    favorites: {
      enabled: false,
      rating_min: 0,
      rating_source: 'auto',
      year_from: null,
      year_to: null,
      quality: [],
      keep_unknown_quality: true,
      include_genres: [],
      exclude_genres: []
    }
  };

  var config = loadConfig();

  var DRAWER_CSS = [
    '.lampa-filters-list{width:100%;max-height:calc(100vh - 9em);overflow-y:auto;padding-right:0.5em}',
    '.lampa-filters-backdrop{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.5);z-index:49}',
    '.lampa-filters-drawer{position:fixed;top:0;right:0;bottom:0;width:460px;max-width:92vw;z-index:50;box-shadow:-6px 0 24px rgba(0,0,0,.5)}',
    '.lampa-filters-panel{display:flex;flex-direction:column;height:100%;background:#262829}',
    '.lampa-filters-panel__head{flex-shrink:0;padding:2em 2em 0.6em;font-size:2.2em;font-weight:300}',
    '.lampa-filters-panel__body{flex-grow:1;overflow-y:auto;padding-bottom:2em}',
    '.lampa-filters-drawer .lampa-filters-list{max-height:none;overflow:visible;padding-right:0}',
    'body.black--style .lampa-filters-panel{background-color:#000}',
    'body.glass--style .lampa-filters-panel,body.glass--style-opacity--medium .lampa-filters-panel,body.glass--style-opacity--blacked .lampa-filters-panel{background-color:#262829}'
  ].join('');

  var drawer = null;
  var backdrop = null;
  var drawerToggled = false;

  function openDrawer() {
    if (drawer) return;
    backdrop = $('<div class="lampa-filters-backdrop"></div>');
    backdrop.on('click', closeDrawer);
    $('body').append(backdrop);
    drawer = $(
      '<div class="lampa-filters-drawer">' +
      '<div class="lampa-filters-panel">' +
      '<div class="lampa-filters-panel__head">Фильтр избранного</div>' +
      '<div class="lampa-filters-panel__body"></div>' +
      '</div>' +
      '</div>');
    var panelBody = drawer.find('.lampa-filters-panel__body');
    var done = $('<div class="settings-param selector" data-static="true">' +
      '<div class="settings-param__name">Готово</div>' +
      '<div class="settings-param__value">закрыть</div></div>');
    bindScrollIntoView(done);
    done.on('hover:enter', closeDrawer);
    panelBody.append(done);
    var body = $('<div class="lampa-filters-list"></div>');
    panelBody.append(body);
    addFilterControls(body, config.favorites, false);
    $('body').append(drawer);
    Lampa.Controller.add('lampa_filters_drawer', {
      toggle: function () {
        drawerToggled = true;
        Lampa.Controller.collectionSet(drawer);
        Lampa.Controller.collectionFocus(false, drawer);
      },
      up: function () { Navigator.move('up'); },
      down: function () { Navigator.move('down'); },
      back: closeDrawer
    });
    Lampa.Controller.toggle('lampa_filters_drawer');
  }

  function closeDrawer() {
    if (!drawer) return;
    drawer.remove();
    drawer = null;
    if (backdrop) {
      backdrop.remove();
      backdrop = null;
    }
    if (drawerToggled) {
      drawerToggled = false;
      Lampa.Controller.back();
    }
    var active = Lampa.Activity.active();
    if (active && active.component === 'favorite') Lampa.Activity.refresh();
  }

  function focusedElement() {
    try {
      if (window.Navigator && Navigator.getFocusedElement) return Navigator.getFocusedElement();
    } catch (error) {}
    return null;
  }


  function loadConfig() {
    var saved = {};
    try { saved = Lampa.Storage.get(STORAGE_KEY, '{}') || {}; } catch (error) { saved = {}; }
    var cfg = JSON.parse(JSON.stringify(DEFAULTS));
    Object.keys(saved).forEach(function (key) {
      if (key !== 'favorites' && saved[key] !== undefined) cfg[key] = saved[key];
    });
    if (saved.favorites) {
      Object.keys(DEFAULTS.favorites).forEach(function (key) {
        if (saved.favorites[key] !== undefined) cfg.favorites[key] = saved.favorites[key];
      });
    }
    return cfg;
  }

  function saveConfig() {
    Lampa.Storage.set(STORAGE_KEY, config);
  }

  function timerLeftText() {
    if (!config.enabled || !config.auto_off_hours || !config.enabled_at) return '';
    var ms = Math.max(0, config.auto_off_hours * 3600000 - (Date.now() - config.enabled_at));
    return ' (авто-выкл через ' + Math.floor(ms / 3600000) + ' ч ' + Math.floor((ms % 3600000) / 60000) + ' мин)';
  }

  function listsActive() {
    if (!config.enabled) return false;
    if (config.auto_off_hours && config.enabled_at &&
        Date.now() - config.enabled_at > config.auto_off_hours * 3600000) {
      config.enabled = false;
      config.enabled_at = 0;
      saveConfig();
      console.log('[lampa-filters] авто-выключение: таймер истёк');
      return false;
    }
    return true;
  }

  var genreCache = Lampa.Storage.get('lampa_filters_genres', '{}') || {};

  function cacheGenres(id, ids) {
    genreCache[id] = ids;
    Lampa.Storage.set('lampa_filters_genres', genreCache);
  }

  function genreIds(item) {
    var ids = (item.genre_ids || []).slice();
    (item.genres || []).forEach(function (genre) {
      if (ids.indexOf(genre.id) === -1) ids.push(genre.id);
    });
    if (!ids.length && item.id in genreCache) {
      (genreCache[item.id] || []).forEach(function (id) {
        ids.push(id);
      });
    }
    return ids;
  }

  function ratingOf(item, source) {
    var tmdb = typeof item.vote_average === 'number' ? item.vote_average : 0;
    var parsed = parseFloat(item.imdb_rating);
    var imdb = !isNaN(parsed) && parsed > 0 ? parsed : null;
    if (source === 'imdb') return imdb;
    if (source === 'tmdb') return tmdb;
    if ((item.vote_count || 0) >= 10) return tmdb;
    return imdb !== null ? imdb : tmdb;
  }

  function yearOf(item) {
    var date = (item.release_date || item.first_air_date || '') + '';
    var year = parseInt(date.slice(0, 4), 10);
    return isNaN(year) ? null : year;
  }

  function looksLikeContent(item) {
    return item.release_date || item.first_air_date || Array.isArray(item.genre_ids) ||
      Array.isArray(item.genres) || typeof item.vote_average === 'number';
  }

  function pass(item, rules) {
    if (!looksLikeContent(item)) return true;
    var ids = genreIds(item);
    var i;
    var excluded = rules.exclude_genres || [];
    for (i = 0; i < excluded.length; i++) {
      if (ids.indexOf(excluded[i]) !== -1) return false;
    }
    var include = rules.include_genres || [];
    if (include.length) {
      var hit = false;
      for (i = 0; i < include.length; i++) {
        if (ids.indexOf(include[i]) !== -1) hit = true;
      }
      if (!hit) return false;
    }
    var quality = (item.release_quality || '').toLowerCase();
    if (CAM_QUALITY.indexOf(quality) !== -1) return false;
    var allowed = (rules.quality || []).map(function (code) { return code.toLowerCase(); });
    if (allowed.length && quality && allowed.indexOf(quality) === -1) return false;
    if (allowed.length && !quality && !rules.keep_unknown_quality) return false;
    if (rules.rating_min) {
      var rating = ratingOf(item, rules.rating_source || 'auto');
      if (rating !== null && rating < rules.rating_min) return false;
    }
    var year = yearOf(item);
    if (rules.year_from && (year === null || year < rules.year_from)) return false;
    if (rules.year_to && (year === null || year > rules.year_to)) return false;
    return true;
  }

  function hookRequests() {
    Lampa.Listener.follow('request_secuses', function (event) {
      try {
        var data = event.data;
        if (!listsActive() || !data || typeof data !== 'object') return;
        if (!Array.isArray(data.results) || !data.results.length) return;
        var url = (event.params && event.params.url) || '';
        if (url.indexOf('/search/') !== -1) return;
        var before = data.results.length;
        var filtered = data.results.filter(function (item) { return pass(item, config); });
        if (filtered.length !== before) {
          data.results = filtered;
          console.log('[lampa-filters] ' + url.slice(0, 80) + ' : отсеяно ' + (before - filtered.length) + ' из ' + before);
        }
      } catch (error) {
        console.warn('[lampa-filters]', error);
      }
    });
  }

  var reliseNextUpstream = 1;

  function hookRelise() {
    if (!Lampa.Api || !Lampa.Api.relise) return;
    var orig = Lampa.Api.relise;
    Lampa.Api.relise = function (params, oncomplite, onerror) {
      var requested = (params && params.page) || 1;
      if (requested <= 1) reliseNextUpstream = 1;
      var page = reliseNextUpstream;
      var collected = [];
      var tries = 0;
      var maxTries = 7;
      function next() {
        tries++;
        orig({ page: page }, function (data) {
          (data.results || []).forEach(function (item) {
            collected.push(item);
          });
          page++;
          var lastUpstream = data.total_pages && (page - 1) >= data.total_pages;
          if (collected.length >= 20 || lastUpstream || tries >= maxTries) {
            reliseNextUpstream = page;
            data.results = collected;
            oncomplite(data);
          } else {
            next();
          }
        }, onerror);
      }
      next();
    };
  }

  var genrePending = {};

  function enrichGenres(items) {
    var need = items.filter(needsEnrich);
    if (!need.length) return;
    if (!Lampa.TMDB || typeof Lampa.TMDB.api !== 'function' ||
        typeof Lampa.TMDB.key !== 'function' || typeof Lampa.Reguest !== 'function') return;
    need.forEach(enrichItem);
  }

  function needsEnrich(item) {
    return looksLikeContent(item) && !genreIds(item).length && item.id &&
      !(item.id in genreCache) && !genrePending[item.id];
  }

  function enrichItem(item) {
    try {
      genrePending[item.id] = true;
      var isTv = !item.release_date && (item.first_air_date || item.name);
      var url = Lampa.TMDB.api((isTv ? 'tv/' : 'movie/') + item.id + '?api_key=' + Lampa.TMDB.key() + '&language=ru');
      var network = new Lampa.Reguest();
      network.silent(url, function (data) {
        if (data && Array.isArray(data.genres) && data.genres.length) {
          cacheGenres(item.id, data.genres.map(function (genre) { return genre.id; }));
          delete genrePending[item.id];
          afterEnrich();
        } else {
          fallbackFind(item);
        }
      }, function () {
        fallbackFind(item);
      });
    } catch (error) {
      console.warn('[lampa-filters]', error);
      delete genrePending[item.id];
      afterEnrich();
    }
  }

  function fallbackFind(item) {
    var finish = function (ids) {
      cacheGenres(item.id, ids || []);
      delete genrePending[item.id];
      afterEnrich();
    };
    if (!item.imdb_id) return finish([]);
    var url = Lampa.TMDB.api('find/' + item.imdb_id + '?external_source=imdb_id&api_key=' + Lampa.TMDB.key() + '&language=ru');
    new Lampa.Reguest().silent(url, function (data) {
      var first = (data.movie_results && data.movie_results[0]) || (data.tv_results && data.tv_results[0]);
      finish(first && Array.isArray(first.genre_ids) ? first.genre_ids : []);
    }, function () {
      finish([]);
    });
  }

  function afterEnrich() {
    if (Object.keys(genrePending).length === 0) {
      console.log('[lampa-filters] жанры избранного получены, обновляю экран');
      Lampa.Activity.refresh();
    }
  }

  function hookFavorite() {
    var orig = Lampa.Favorite.get;
    Lampa.Favorite.get = function () {
      var res = orig.apply(this, arguments);
      try {
        if (Array.isArray(res) && config.favorites.enabled) {
          var unknown = res.filter(needsEnrich);
          if (unknown.length) enrichGenres(unknown);
          var before = res.length;
          res = res.filter(function (item) {
            if (needsEnrich(item)) return true;
            return pass(item, config.favorites);
          });
          if (res.length !== before || unknown.length) console.log('[lampa-filters] избранное: ' + before + ' -> ' + res.length + ' (жанры уточняются: ' + unknown.length + ')');
        }
      } catch (error) {
        console.warn('[lampa-filters]', error);
      }
      return res;
    };
  }

  function bindScrollIntoView(el) {
    el.on('hover:focus', function (event) {
      try {
        if (event.target && event.target.scrollIntoView) event.target.scrollIntoView({ block: 'nearest' });
      } catch (error) {}
    });
    return el;
  }

  function restoreFocus(restore, focusedBefore) {
    if (restore) Lampa.Controller.toggle(restore);
    if (focusedBefore) Lampa.Controller.collectionFocus(focusedBefore);
  }

  function choose(title, options, current, onSelect) {
    var restore = (Lampa.Controller.enabled() || {}).name;
    var focusedBefore = focusedElement();
    Lampa.Select.show({
      title: title,
      items: options.map(function (option) {
        return { title: option.title, selected: option.value === current, __value: option.value };
      }),
      onSelect: function (element) {
        restoreFocus(restore, focusedBefore);
        onSelect(element.__value);
      },
      onBack: function () {
        restoreFocus(restore, focusedBefore);
      }
    });
  }

  function ratingOptions() {
    var options = [{ title: 'выкл', value: 0 }];
    for (var value = 1; value <= 10; value += 0.5) {
      options.push({ title: String(value).replace('.', ','), value: value });
    }
    return options;
  }

  function yearOptions() {
    var options = [{ title: '—', value: null }];
    for (var year = new Date().getFullYear() + 1; year >= 1950; year--) {
      options.push({ title: String(year), value: year });
    }
    return options;
  }

  function hoursOptions() {
    return [0, 1, 3, 6, 12, 24].map(function (hours) {
      return { title: hours ? hours + ' ч' : 'выкл', value: hours };
    });
  }

  function sourceOptions() {
    return [
      { title: 'auto (TMDB при 10+ голосах, иначе IMDb)', value: 'auto' },
      { title: 'только TMDB', value: 'tmdb' },
      { title: 'только IMDb', value: 'imdb' }
    ];
  }

  function addFilterControls(body, rules, main) {
    function mk(name) {
      var value = $('<div class="settings-param__value"></div>');
      body.append($('<div class="settings-param selector" data-static="true"></div>')
        .append('<div class="settings-param__name">' + name + '</div>').append(value));
      var el = body.children().last();
      bindScrollIntoView(el);
      return {
        el: el,
        set: function (text) { value.text(text); }
      };
    }

    function section(text) {
      body.append('<div class="settings-param-title"><span>' + text + '</span></div>');
    }

    function toggleIn(list, value) {
      var index = list.indexOf(value);
      if (index === -1) list.push(value); else list.splice(index, 1);
    }

    function commit() {
      if (!rules.enabled) {
        rules.enabled = true;
        if (main) rules.enabled_at = Date.now();
      }
      saveConfig();
      refreshEnabled();
    }

    if (main) {
      var exit = mk('Вернуться в настройки');
      exit.el.on('hover:enter', function () {
        Lampa.Controller.back();
      });
    }

    var enabled = mk('Фильтр');
    function refreshEnabled() {
      if (main) enabled.set((config.enabled ? 'вкл' : 'выкл') + timerLeftText());
      else enabled.set(rules.enabled ? 'вкл' : 'выкл');
    }
    refreshEnabled();
    enabled.el.on('hover:enter', function () {
      rules.enabled = !rules.enabled;
      if (main && rules.enabled) rules.enabled_at = Date.now();
      if (main && !rules.enabled) rules.enabled_at = 0;
      saveConfig();
      refreshEnabled();
    });

    if (main) {
      var hours = mk('Авто-выключение через');
      function refreshHours() {
        hours.set(config.auto_off_hours ? config.auto_off_hours + ' ч' : 'выкл');
      }
      refreshHours();
      hours.el.on('hover:enter', function () {
        choose('Авто-выключение', hoursOptions(), config.auto_off_hours, function (value) {
          config.auto_off_hours = value;
          if (value && config.enabled && !config.enabled_at) config.enabled_at = Date.now();
          saveConfig();
          refreshHours();
          refreshEnabled();
        });
      });
    }

    var rating = mk('Рейтинг от');
    function refreshRating() {
      rating.set(rules.rating_min ? String(rules.rating_min).replace('.', ',') : 'выкл');
    }
    refreshRating();
    rating.el.on('hover:enter', function () {
      choose('Рейтинг от', ratingOptions(), rules.rating_min, function (value) {
        rules.rating_min = value;
        commit();
        refreshRating();
      });
    });

    var source = mk('Источник рейтинга');
    function refreshSource() {
      source.set(rules.rating_source === 'auto' ? 'auto' : rules.rating_source);
    }
    refreshSource();
    source.el.on('hover:enter', function () {
      choose('Источник рейтинга', sourceOptions(), rules.rating_source, function (value) {
        rules.rating_source = value;
        commit();
        refreshSource();
      });
    });

    var yearFrom = mk('Год от');
    var yearTo = mk('Год по');
    function refreshYears() {
      yearFrom.set(rules.year_from ? String(rules.year_from) : '—');
      yearTo.set(rules.year_to ? String(rules.year_to) : '—');
    }
    refreshYears();
    yearFrom.el.on('hover:enter', function () {
      choose('Год от', yearOptions(), rules.year_from, function (value) {
        rules.year_from = value;
        commit();
        refreshYears();
      });
    });
    yearTo.el.on('hover:enter', function () {
      choose('Год по', yearOptions(), rules.year_to, function (value) {
        rules.year_to = value;
        commit();
        refreshYears();
      });
    });

    section('Качество (экранка ts/tc отсеивается всегда)');

    QUALITIES.forEach(function (quality) {
      var row = mk(quality.title);
      function refresh() {
        row.set((rules.quality || []).indexOf(quality.code) !== -1 ? '✓' : '—');
      }
      refresh();
      row.el.on('hover:enter', function () {
        toggleIn(rules.quality, quality.code);
        commit();
        refresh();
      });
    });

    var keepUnknown = mk('Пропускать без данных о качестве');
    function refreshKeep() {
      keepUnknown.set(rules.keep_unknown_quality ? 'вкл' : 'выкл');
    }
    refreshKeep();
    keepUnknown.el.on('hover:enter', function () {
      rules.keep_unknown_quality = !rules.keep_unknown_quality;
      commit();
      refreshKeep();
    });

    section('Жанры');

    function genrePickerRow(name, list) {
      var row = mk(name);
      function genreTitle(id) {
        var found = GENRES.filter(function (genre) { return genre.id === id; });
        return found.length ? found[0].title : String(id);
      }
      function refresh() {
        if (!list.length) {
          row.set('нет');
          return;
        }
        var names = list.slice(0, 2).map(genreTitle).join(', ');
        row.set(list.length > 2 ? names + ' +' + (list.length - 2) : names);
      }
      refresh();
      row.el.on('hover:enter', function () {
        var restore = (Lampa.Controller.enabled() || {}).name;
        var focusedBefore = focusedElement();
        Lampa.Select.show({
          title: name,
          items: GENRES.map(function (genre) {
            return {
              id: genre.id,
              title: genre.title + ' (' + genre.id + ')',
              checkbox: true,
              checked: list.indexOf(genre.id) !== -1
            };
          }),
          onCheck: function (element) {
            var index = list.indexOf(element.id);
            if (element.checked && index === -1) list.push(element.id);
            if (!element.checked && index !== -1) list.splice(index, 1);
            commit();
            refresh();
          },
          onBack: function () {
            restoreFocus(restore, focusedBefore);
          }
        });
      });
    }

    genrePickerRow('Исключить жанры (любое вхождение = скрыть)', rules.exclude_genres);
    genrePickerRow('Только жанры (хотя бы один; пусто = любые)', rules.include_genres);
  }

  function hookSettings() {
    Lampa.SettingsApi.addComponent({
      component: 'lampa_filters',
      icon: ICON,
      name: 'Фильтры подборок'
    });

    Lampa.Settings.listener.follow('open', function (event) {
      if (event.name !== 'lampa_filters') return;
      var body = event.body;
      var scrollBody = body.find('.scroll__body').first();
      if (!scrollBody.length) scrollBody = body.find('.scroll__content').first();
      if (!scrollBody.length) scrollBody = body;
      var host = scrollBody.children().first();
      if (!host.length) host = scrollBody;
      host.empty();
      var list = $('<div class="lampa-filters-list"></div>');
      host.append(list);
      list.append('<div class="settings-param-title"><span>Подборки (релизы, каталог, главная, топ, коллекции)</span></div>');
      addFilterControls(list, config, true);
      var favRow = $('<div class="settings-param selector" data-static="true">' +
        '<div class="settings-param__name">Избранное (отдельные правила)</div>' +
        '<div class="settings-param__value">' + (config.favorites.enabled ? 'вкл, открыть' : 'выкл, открыть') + '</div></div>');
      bindScrollIntoView(favRow);
      favRow.on('hover:enter', openDrawer);
      list.append(favRow);
      try {
        var rows = list.find('.selector').toArray();
        if (rows.length && Lampa.Controller.collectionAppend) Lampa.Controller.collectionAppend(rows);
      } catch (error) {
        console.warn('[lampa-filters]', error);
      }
    });
  }

  function summary() {
    var parts = [];
    if (config.rating_min) parts.push('рейтинг >= ' + config.rating_min + ' (' + config.rating_source + ')');
    if (config.exclude_genres.length) parts.push('без жанров ' + config.exclude_genres.join(','));
    if (config.include_genres.length) parts.push('только жанры ' + config.include_genres.join(','));
    if (config.year_from || config.year_to) parts.push('годы ' + (config.year_from || '...') + '-' + (config.year_to || '...'));
    if (config.quality && config.quality.length) parts.push('качество ' + config.quality.join('/'));
    parts.push('экранка всегда отсеивается');
    return parts.join('; ');
  }

  function addHeadIcon() {
    if (!Lampa.Head || !Lampa.Head.addIcon || !Lampa.Head.render) return;
    var attempts = 0;
    (function tryAdd() {
      var headHtml = null;
      try {
        headHtml = Lampa.Head.render();
      } catch (error) {}
      if (headHtml && headHtml.length) {
        try {
          Lampa.Head.addIcon(ICON, openDrawer);
          console.log('[lampa-filters] кнопка фильтра добавлена в шапку');
        } catch (error) {
          console.warn('[lampa-filters]', error);
        }
      } else if (attempts++ < 100) {
        setTimeout(tryAdd, 100);
      }
    })();
  }

  function start() {
    if (config.enabled && config.auto_off_hours && !config.enabled_at) {
      config.enabled_at = Date.now();
      saveConfig();
    }
    $('head').append('<style>' + DRAWER_CSS + '</style>');
    hookRequests();
    hookRelise();
    hookFavorite();
    hookSettings();
    addHeadIcon();
    if (listsActive()) {
      console.log('%c[lampa-filters] v' + VERSION + ' активен: ' + summary(), 'color:#0a0;font-weight:bold');
    } else {
      console.log('[lampa-filters] фильтр выключен');
    }
    if (config.favorites.enabled) console.log('[lampa-filters] избранное фильтруется');
  }

  (function wait() {
    if (window.Lampa && Lampa.SettingsApi && Lampa.Api && Lampa.Favorite && Lampa.Select && Lampa.Listener) start();
    else setTimeout(wait, 50);
  })();
})();
