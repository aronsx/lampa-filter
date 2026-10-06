(function () {
  'use strict';

  var STORAGE_KEY = 'lampa_filters';
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

  var ICON = '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#ddd" stroke-width="1.5"><path d="M4 5h16l-6 7v6l-4 2v-8z"/></svg>';

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

  function genreIds(item) {
    var ids = (item.genre_ids || []).slice();
    (item.genres || []).forEach(function (genre) {
      if (ids.indexOf(genre.id) === -1) ids.push(genre.id);
    });
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

  function hookAjax() {
    if (!window.jQuery || !jQuery.ajax || jQuery.ajax.__lampaFilters) return;
    var orig = jQuery.ajax;
    var wrapped = function (settings) {
      if (settings && typeof settings === 'object' && typeof settings.success === 'function' && settings.url) {
        var url = settings.url;
        var userSuccess = settings.success;
        settings = jQuery.extend({}, settings, {
          success: function (data) {
            try {
              if (listsActive() && data && typeof data === 'object' && Array.isArray(data.results) &&
                  data.results.length && url.indexOf('/search/') === -1) {
                var before = data.results.length;
                data.results = data.results.filter(function (item) { return pass(item, config); });
                var dropped = before - data.results.length;
                if (dropped) console.log('[lampa-filters] ' + url.slice(0, 80) + ' : отсеяно ' + dropped + ' из ' + before);
              }
            } catch (error) {
              console.warn('[lampa-filters]', error);
            }
            return userSuccess.apply(this, arguments);
          }
        });
      }
      return orig.call(jQuery, settings);
    };
    wrapped.__lampaFilters = true;
    jQuery.ajax = wrapped;
  }

  function hookFavorite() {
    var orig = Lampa.Favorite.get;
    Lampa.Favorite.get = function () {
      var res = orig.apply(this, arguments);
      if (Array.isArray(res) && config.favorites.enabled) {
        var before = res.length;
        res = res.filter(function (item) { return pass(item, config.favorites); });
        if (res.length !== before) console.log('[lampa-filters] избранное: ' + before + ' -> ' + res.length);
      }
      return res;
    };
  }

  function choose(title, options, current, onSelect) {
    Lampa.Select.show({
      title: title,
      items: options.map(function (option) {
        return { title: option.title, selected: option.value === current, __value: option.value };
      }),
      onSelect: function (a, item) {
        if (item) onSelect(item.__value);
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
        saveConfig();
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
        saveConfig();
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
        saveConfig();
        refreshYears();
      });
    });
    yearTo.el.on('hover:enter', function () {
      choose('Год по', yearOptions(), rules.year_to, function (value) {
        rules.year_to = value;
        saveConfig();
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
        saveConfig();
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
      saveConfig();
      refreshKeep();
    });

    section('Исключить жанры (любое вхождение = карточка скрыта)');

    GENRES.forEach(function (genre) {
      var row = mk(genre.title + ' (' + genre.id + ')');
      function refresh() {
        row.set((rules.exclude_genres || []).indexOf(genre.id) !== -1 ? '✓' : '—');
      }
      refresh();
      row.el.on('hover:enter', function () {
        toggleIn(rules.exclude_genres, genre.id);
        saveConfig();
        refresh();
      });
    });

    section('Только жанры (хотя бы один; пусто = любые)');

    GENRES.forEach(function (genre) {
      var row = mk(genre.title + ' (' + genre.id + ')');
      function refresh() {
        row.set((rules.include_genres || []).indexOf(genre.id) !== -1 ? '✓' : '—');
      }
      refresh();
      row.el.on('hover:enter', function () {
        toggleIn(rules.include_genres, genre.id);
        saveConfig();
        refresh();
      });
    });
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
      body.empty();
      body.append('<div class="settings-param-title"><span>Подборки (релизы, каталог, главная, топ, коллекции)</span></div>');
      addFilterControls(body, config, true);
      body.append('<div class="settings-param-title"><span>Избранное (отдельные правила)</span></div>');
      addFilterControls(body, config.favorites, false);
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

  function start() {
    if (config.enabled && config.auto_off_hours && !config.enabled_at) {
      config.enabled_at = Date.now();
      saveConfig();
    }
    hookAjax();
    hookFavorite();
    hookSettings();
    if (listsActive()) {
      console.log('%c[lampa-filters] активен: ' + summary(), 'color:#0a0;font-weight:bold');
    } else {
      console.log('[lampa-filters] фильтр выключен');
    }
    if (config.favorites.enabled) console.log('[lampa-filters] избранное фильтруется');
  }

  (function wait() {
    if (window.Lampa && Lampa.SettingsApi && Lampa.Favorite && Lampa.Select && window.jQuery) start();
    else setTimeout(wait, 50);
  })();
})();
