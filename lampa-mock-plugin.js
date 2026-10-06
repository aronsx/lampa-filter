(function () {
  var onMockOrigin = (location.hostname === '127.0.0.1' || location.hostname === 'localhost') && location.port === '8180';
  var MOCK = onMockOrigin ? '' : 'http://127.0.0.1:8180';
  var GEN = '';
  var FAV = null;

  function appendGen(url) {
    return GEN ? url + (/\?/.test(url) ? '&' : '?') + 'gen=' + GEN : url;
  }

  function api(url) {
    var sep = /\?/.test(url) ? '&' : '?';
    return appendGen(MOCK + '/3/' + url + sep + 'mock=1');
  }

  function relise(params, oncomplite, onerror) {
    var page = (params && params.page) || 1;
    fetch(appendGen(MOCK + '/releases?page=' + page))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        (data.results || []).forEach(function (item) {
          if (!item.source) item.source = 'tmdb';
        });
        oncomplite(data);
      })
      .catch(function (e) { onerror(e); });
  }

  function hookAjax() {
    if (!window.jQuery || !jQuery.ajax || jQuery.ajax.__lampaMocked) return;
    var orig = jQuery.ajax;
    var wrapped = function (settings) {
      try {
        var url = typeof settings === 'string' ? settings : settings && settings.url;
        if (url && /^https?:\/\/tmdb\./.test(url)) {
          var rel = url.replace(/^https?:\/\/[^/]+/, '');
          var next = MOCK + '/cub' + (rel.charAt(0) === '/' ? rel : '/' + rel);
          next += (next.indexOf('?') > -1 ? '&' : '?') + 'mock=1';
          next = appendGen(next);
          if (typeof settings === 'string') return orig.call(jQuery, next);
          settings = jQuery.extend({}, settings, { url: next });
        }
      } catch (e) {}
      return orig.call(jQuery, settings);
    };
    wrapped.__lampaMocked = true;
    jQuery.ajax = wrapped;
  }

  function itemGenres(item) {
    var genres = (item.genre_ids || []).slice();
    (item.genres || []).forEach(function (g) {
      if (genres.indexOf(g.id) === -1) genres.push(g.id);
    });
    return genres;
  }

  function itemRating(item) {
    var tmdb = item.vote_average || 0;
    var imdb = item.imdb_rating ? parseFloat(item.imdb_rating) : null;
    if (imdb !== null && (isNaN(imdb) || imdb <= 0)) imdb = null;
    var source = (FAV && FAV.rating_source) || 'auto';
    if (source === 'imdb') return imdb;
    if (source === 'tmdb') return tmdb;
    if ((item.vote_count || 0) >= 10) return tmdb;
    return imdb !== null ? imdb : tmdb;
  }

  function itemYear(item) {
    var date = (item.release_date || item.first_air_date || '') + '';
    var year = parseInt(date.slice(0, 4), 10);
    return isNaN(year) ? null : year;
  }

  function favPass(item) {
    if (!FAV || !FAV.enabled) return true;
    var genres = itemGenres(item);
    var i;
    var excluded = FAV.exclude_genres || [];
    for (i = 0; i < excluded.length; i++) {
      if (genres.indexOf(excluded[i]) !== -1) return false;
    }
    var include = FAV.include_genres || [];
    if (include.length) {
      var hit = false;
      for (i = 0; i < include.length; i++) {
        if (genres.indexOf(include[i]) !== -1) hit = true;
      }
      if (!hit) return false;
    }
    var quality = (item.release_quality || '').toLowerCase();
    if (quality === 'ts' || quality === 'tc') return false;
    var allowed = (FAV.quality || []).map(function (x) { return x.toLowerCase(); });
    if (allowed.length && quality && allowed.indexOf(quality) === -1) return false;
    if (allowed.length && !quality && !FAV.keep_unknown_quality) return false;
    var rating = itemRating(item);
    if (FAV.rating_min && rating !== null && rating < FAV.rating_min) return false;
    var year = itemYear(item);
    if (FAV.year_from && (year === null || year < FAV.year_from)) return false;
    if (FAV.year_to && (year === null || year > FAV.year_to)) return false;
    return true;
  }

  function loadFilters() {
    return fetch(MOCK + '/filters')
      .then(function (r) { return r.json(); })
      .then(function (f) {
        GEN = f.cache_gen || '';
        FAV = f.favorites || null;
        return f;
      });
  }

  function apply() {
    Lampa.TMDB.api = api;
    Lampa.Api.relise = relise;

    var origFavoriteGet = Lampa.Favorite.get;
    Lampa.Favorite.get = function () {
      var res = origFavoriteGet.apply(this, arguments);
      if (Array.isArray(res) && FAV && FAV.enabled) {
        var before = res.length;
        res = res.filter(favPass);
        console.log('[lampa-mock] favorite.get', before, '->', res.length);
      }
      return res;
    };

    hookAjax();

    console.log('%c[lampa-mock] активен -> ' + (MOCK || location.origin), 'color:#0a0;font-weight:bold');

    loadFilters().then(function (f) {
      console.log('[lampa-mock] пресет:', f);
    });
    setInterval(loadFilters, 60000);
  }

  (function wait() {
    if (window.Lampa && Lampa.TMDB && Lampa.Api && Lampa.Favorite) apply();
    else setTimeout(wait, 50);
  })();
})();
