import asyncio
import json
import time
from collections import deque
from datetime import datetime
from pathlib import Path
from string import Template
from urllib.parse import urlencode

import httpx
from fastapi import FastAPI, Request, Response
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

MOCK_PORT = 8180
CACHE_GEN = str(int(time.time()))
UPSTREAM_API = "https://apitmdb.cubnotrip.top/3"
UPSTREAM_RELEASES = "https://tmdb.cubnotrip.top"
LIST_PATHS = ("discover", "trending", "now_playing", "popular", "top_rated",
              "upcoming", "similar", "recommendations", "airing_today", "on_the_air")
CAM_QUALITY = ("ts", "tc")
CACHE_TTL = 600
PREFETCH_AHEAD = 10
MAX_UPSTREAM_PAGE = 500
MIRROR_DIR = Path(__file__).parent / "mirror"

FILTERS = {
    "enabled": True,
    "rating_min": 7.0,
    "rating_source": "auto",
    "year_from": None,
    "year_to": None,
    "include_genres": [],
    "exclude_genres": [27],
    "quality": ["webdl", "4k"],
    "keep_unknown_quality": True,
    "expires_at": None,
    "favorites": {
        "enabled": False,
        "rating_min": 0,
        "rating_source": "auto",
        "year_from": None,
        "year_to": None,
        "include_genres": [],
        "exclude_genres": [],
        "quality": [],
        "keep_unknown_quality": True,
    },
}
DEFAULT_EXPIRY_HOURS = 12
GENRES = {
    28: "боевик", 12: "приключения", 16: "мультфильм", 35: "комедия",
    80: "криминал", 99: "документальный", 18: "драма", 10751: "семейный",
    14: "фэнтези", 36: "история", 27: "ужасы", 10402: "музыка",
    9648: "детектив", 10749: "мелодрама", 878: "фантастика",
    10770: "телефильм", 53: "триллер", 10752: "военный", 37: "вестерн",
}

MARKER_API = {
    "adult": False, "backdrop_path": None, "id": 999999001,
    "title": "MOCK: подмена работает", "original_title": "MOCK OK",
    "overview": "Ответ обслужен локальным моком lampa-filters",
    "poster_path": None, "media_type": "movie", "genre_ids": [99],
    "popularity": 0.0, "release_date": "2026-01-01", "video": False,
    "vote_average": 10.0, "vote_count": 1,
}
MARKER_RELEASES = dict(MARKER_API, release_quality="4K")

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Private-Network": "true",
}

client = httpx.AsyncClient(timeout=20.0, follow_redirects=True)
app = FastAPI()
stats = {"total": 0}
LOG = deque(maxlen=80)
CACHE = {}
INFLIGHT = {}
PREFETCH_TASKS = set()
SEM = asyncio.Semaphore(4)


async def upstream_get(url, params):
    last_error = None
    for attempt in range(3):
        try:
            return await client.get(url, params=params)
        except httpx.TransportError as error:
            last_error = error
            await asyncio.sleep(0.3 * (attempt + 1))
    raise last_error


def note_request(path, status, note=""):
    stats["total"] += 1
    stamp = datetime.now().strftime("%H:%M:%S")
    LOG.append(f"{stamp}  {path}  [{status}]  {note}".rstrip())


def cache_get(key):
    hit = CACHE.get(key)
    if hit and hit[0] > time.time():
        return hit[1]
    return None


def cache_put(key, value):
    CACHE[key] = (time.time() + CACHE_TTL, value)


def clear_cache():
    CACHE.clear()


def check_expiry():
    expires = FILTERS.get("expires_at")
    if FILTERS.get("enabled") and expires and time.time() > expires:
        FILTERS["enabled"] = False
        FILTERS["expires_at"] = None
        clear_cache()
        note_request("/filters", 200, "авто-выключение: таймер истёк")


def year_of(item):
    date = item.get("release_date") or item.get("first_air_date") or ""
    return int(date[:4]) if date[:4].isdigit() else None


def rating_of(item):
    tmdb = item.get("vote_average") or 0.0
    try:
        imdb = float(item["imdb_rating"]) if item.get("imdb_rating") else None
    except (TypeError, ValueError):
        imdb = None
    source = FILTERS.get("rating_source", "auto")
    if source == "imdb":
        return imdb
    if source == "tmdb":
        return tmdb
    if (item.get("vote_count") or 0) >= 10:
        return tmdb
    return imdb if imdb is not None else tmdb


def drop_reason(item):
    if not FILTERS.get("enabled", False):
        return None
    genres = set(item.get("genre_ids") or [])
    genres |= {g.get("id") for g in item.get("genres") or []}
    excluded = set(FILTERS.get("exclude_genres") or [])
    if excluded & genres:
        return "исключённый жанр: " + ", ".join(str(x) for x in sorted(excluded & genres))
    include = set(FILTERS.get("include_genres") or [])
    if include and not include & genres:
        return "нет ни одного из включаемых жанров"
    quality = (item.get("release_quality") or "").lower()
    if quality in CAM_QUALITY:
        return f"экранка ({quality})"
    allowed = {q.lower() for q in FILTERS.get("quality") or []}
    if allowed and quality and quality not in allowed:
        return f"качество {quality} не выбрано"
    if allowed and not quality and not FILTERS.get("keep_unknown_quality", True):
        return "качество неизвестно"
    rating = rating_of(item)
    if FILTERS.get("rating_min") and rating is not None and rating < FILTERS["rating_min"]:
        return f"рейтинг {round(float(rating), 1)} < {FILTERS['rating_min']}"
    year = year_of(item)
    if FILTERS.get("year_from") and (year is None or year < FILTERS["year_from"]):
        return f"год {year} вне диапазона"
    if FILTERS.get("year_to") and (year is None or year > FILTERS["year_to"]):
        return f"год {year} вне диапазона"
    return None


def pass_filter(item):
    return drop_reason(item) is None


async def _fetch_releases_page(page):
    upstream = await upstream_get(UPSTREAM_RELEASES + "/",
                                  {"sort": "releases", "results": 20, "page": page})
    data = {}
    if "json" in upstream.headers.get("content-type", ""):
        try:
            data = upstream.json()
        except ValueError:
            data = {}
    results = data.get("results") or []
    page_data = {
        "page": data.get("page", page),
        "total_pages": data.get("total_pages"),
        "total_results": data.get("total_results"),
        "upstream_status": upstream.status_code,
        "in_count": len(results),
        "results": [item for item in results if pass_filter(item)],
    }
    cache_put(f"releases:{page}", page_data)
    return page_data


async def load_releases_page(page):
    key = f"releases:{page}"
    cache = cache_get(key)
    if cache is not None:
        return cache, True
    task = INFLIGHT.get(key)
    if task is None:
        task = asyncio.create_task(_fetch_releases_page(page))
        INFLIGHT[key] = task
        task.add_done_callback(lambda t, k=key: INFLIGHT.pop(k, None))
    return await task, False


async def prefetch_releases(base_page, total_pages):
    loaded = 0

    async def one(page):
        nonlocal loaded
        if total_pages and page > total_pages:
            return
        if page > MAX_UPSTREAM_PAGE or cache_get(f"releases:{page}") is not None:
            return
        async with SEM:
            try:
                await load_releases_page(page)
                loaded += 1
            except Exception:
                pass

    await asyncio.gather(*(one(base_page + step) for step in range(1, PREFETCH_AHEAD + 1)))
    if loaded:
        note_request(f"/releases prefetch", 200, f"pages {base_page + 1}..{base_page + PREFETCH_AHEAD}, loaded {loaded}")


def schedule(coro):
    task = asyncio.create_task(coro)
    PREFETCH_TASKS.add(task)
    task.add_done_callback(PREFETCH_TASKS.discard)


def is_list_path(path):
    return any(mark in path for mark in LIST_PATHS)


async def _fetch_tmdb_list(path, params):
    upstream = await upstream_get(f"{UPSTREAM_API}/{path}", params)
    data = None
    if upstream.status_code == 200 and "json" in upstream.headers.get("content-type", ""):
        try:
            data = upstream.json()
        except ValueError:
            data = None
    if not isinstance(data, dict) or not isinstance(data.get("results"), list):
        return None
    payload = {
        "page": data.get("page"),
        "total_pages": data.get("total_pages"),
        "total_results": data.get("total_results"),
        "in_count": len(data["results"]),
        "body": dict(data, results=[item for item in data["results"] if pass_filter(item)]),
    }
    cache_put(tmdb_cache_key(path, params), payload)
    return payload


def tmdb_cache_key(path, params):
    return f"tmdb:{path}?{urlencode(sorted(params.items()))}"


async def load_tmdb_list(path, params):
    key = tmdb_cache_key(path, params)
    cache = cache_get(key)
    if cache is not None:
        return cache, True
    task = INFLIGHT.get(key)
    if task is None:
        task = asyncio.create_task(_fetch_tmdb_list(path, params))
        INFLIGHT[key] = task
        task.add_done_callback(lambda t, k=key: INFLIGHT.pop(k, None))
    return await task, False


async def prefetch_tmdb(base_path, params, base_page, total_pages):
    loaded = 0

    async def one(page):
        nonlocal loaded
        if total_pages and page > total_pages:
            return
        if page > MAX_UPSTREAM_PAGE:
            return
        next_params = dict(params, page=page)
        if cache_get(tmdb_cache_key(base_path, next_params)) is not None:
            return
        async with SEM:
            try:
                await load_tmdb_list(base_path, next_params)
                loaded += 1
            except Exception:
                pass

    await asyncio.gather(*(one(base_page + step) for step in range(1, PREFETCH_AHEAD + 1)))
    if loaded:
        note_request(f"/3/{base_path} prefetch", 200, f"pages {base_page + 1}..{base_page + PREFETCH_AHEAD}, loaded {loaded}")


@app.middleware("http")
async def cors_middleware(request: Request, call_next):
    if request.method == "OPTIONS":
        return Response(status_code=204, headers=CORS)
    check_expiry()
    response = await call_next(request)
    response.headers.update(CORS)
    return response


@app.get("/3/{path:path}")
async def tmdb_proxy(path: str, request: Request):
    params = {k: v for k, v in request.query_params.items() if k not in ("mock", "gen")}
    wants_marker = request.query_params.get("mock") == "1"
    page = params.get("page")

    if is_list_path(path) and page:
        try:
            payload, cached = await load_tmdb_list(path, params)
        except httpx.TransportError as error:
            note_request(f"/3/{path}", 502, f"upstream down: {type(error).__name__}")
            return JSONResponse({"error": "upstream unavailable"}, status_code=502)
        if payload is not None:
            body = payload["body"]
            results = list(body.get("results") or [])
            marker = ""
            if wants_marker and str(page) == "1":
                results.insert(0, MARKER_API)
                marker = ", +marker"
            body = dict(body, results=results)
            note_request(f"/3/{path}", 200,
                         f"list page {page}, {payload['in_count']}->{len(results)}{marker}, {'cache' if cached else 'upstream'}")
            schedule(prefetch_tmdb(path, params, int(page), body.get("total_pages")))
            return JSONResponse(body)

    try:
        upstream = await upstream_get(f"{UPSTREAM_API}/{path}", params)
    except httpx.TransportError as error:
        note_request(f"/3/{path}", 502, f"upstream down: {type(error).__name__}")
        return JSONResponse({"error": "upstream unavailable"}, status_code=502)
    note_request(f"/3/{path}", upstream.status_code, f"passthrough {len(upstream.content)}b")
    return Response(upstream.content, status_code=upstream.status_code,
                    media_type=upstream.headers.get("content-type", "application/json"))


@app.get("/cub/{path:path}")
async def cub_proxy(path: str, request: Request):
    params = {k: v for k, v in request.query_params.items() if k not in ("mock", "gen")}
    wants_marker = request.query_params.get("mock") == "1"
    try:
        upstream = await upstream_get(f"{UPSTREAM_RELEASES}/{path}", params)
    except httpx.TransportError as error:
        note_request(f"/cub/{path}", 502, f"upstream down: {type(error).__name__}")
        return JSONResponse({"error": "upstream unavailable"}, status_code=502)
    content_type = upstream.headers.get("content-type", "")
    data = None
    if "json" in content_type:
        try:
            data = upstream.json()
        except ValueError:
            data = None
    if isinstance(data, dict) and isinstance(data.get("results"), list):
        results = [item for item in data["results"] if pass_filter(item)]
        marker = ""
        if wants_marker and str(params.get("page", "1")) == "1":
            results.insert(0, MARKER_RELEASES)
            marker = ", +marker"
        label = params.get("sort") or params.get("cat") or path or "-"
        note_request(f"/cub/{path}", upstream.status_code,
                     f"{label}: {len(data['results'])}->{len(results)}{marker}")
        return JSONResponse(dict(data, results=results), status_code=upstream.status_code)
    note_request(f"/cub/{path}", upstream.status_code, f"passthrough {len(upstream.content)}b")
    return Response(upstream.content, status_code=upstream.status_code,
                    media_type=content_type or "application/json")


@app.get("/releases")
async def releases(request: Request):
    try:
        page = max(1, int(request.query_params.get("page", 1)))
    except ValueError:
        page = 1
    try:
        data, cached = await load_releases_page(page)
    except httpx.TransportError as error:
        note_request("/releases", 502, f"page {page}, upstream down: {type(error).__name__}")
        return JSONResponse({"error": "upstream unavailable"}, status_code=502)
    if data["upstream_status"] != 200 and not data["results"]:
        note_request("/releases", data["upstream_status"], f"page {page}, upstream error")
        return JSONResponse(data, status_code=data["upstream_status"])
    results = list(data["results"])
    marker = ""
    if page == 1:
        results.insert(0, MARKER_RELEASES)
        marker = ", +marker"
    body = {
        "page": data["page"], "total_pages": data["total_pages"],
        "total_results": data["total_results"], "results": results,
    }
    note_request("/releases", 200,
                 f"page {page}, {data['in_count']}->{len(results)}{marker}, {'cache' if cached else 'upstream'}")
    schedule(prefetch_releases(page, data.get("total_pages")))
    return JSONResponse(body)


@app.get("/debug/releases")
async def debug_releases(request: Request):
    try:
        page = max(1, int(request.query_params.get("page", 1)))
    except ValueError:
        page = 1
    upstream = await upstream_get(UPSTREAM_RELEASES + "/",
                                  {"sort": "releases", "results": 20, "page": page})
    data = {}
    if "json" in upstream.headers.get("content-type", ""):
        try:
            data = upstream.json()
        except ValueError:
            data = {}
    items = data.get("results") or []
    rows = []
    kept_n = 0
    for item in items:
        reason = drop_reason(item)
        kept = reason is None
        if kept:
            kept_n += 1
        color = "#4caf50" if kept else "#e05252"
        verdict = "ПРОШЁЛ" if kept else reason
        rating = rating_of(item)
        rating_txt = "-" if rating is None else round(float(rating), 1)
        genres = ", ".join(str(g) for g in (item.get("genre_ids") or []))
        rows.append(
            f"<tr><td style='color:{color}'>{verdict}</td><td>{item.get('title', '')}</td>"
            f"<td>{rating_txt}</td><td>{item.get('release_quality', '-') or '-'}</td>"
            f"<td>{item.get('release_date', '')}</td><td>{genres}</td></tr>")
    state = "ВКЛ" if FILTERS.get("enabled") else "выкл"
    total_pages = data.get("total_pages") or 1
    nav = " ".join(f"<a class='{'cur' if p == page else ''}' href='/debug/releases?page={p}'>{p}</a>"
                   for p in range(1, max(2, min(total_pages, 7)) + 1))
    html = f"""<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><title>debug releases</title>
<style>
body {{ font-family: -apple-system, sans-serif; background: #141519; color: #ddd; margin: 24px; }}
table {{ border-collapse: collapse; margin-top: 12px; }} td, th {{ padding: 4px 12px 4px 0; font-size: 13px; text-align: left; }}
th {{ color: #888; font-weight: normal; }} a {{ color: #6ab0f3; margin-right: 6px; }} .cur {{ color: #fff; font-weight: bold; }}
</style></head><body>
<h1>Релизы, страница {page} (фильтр {state}) - прошло {kept_n} из {len(items)}</h1>
<p>{nav}</p>
<table><tr><th>вердикт</th><th>название</th><th>рейтинг</th><th>качество</th><th>дата</th><th>жанры (id)</th></tr>
{''.join(rows)}</table>
</body></html>"""
    return HTMLResponse(html)


SETTINGS_PAGE = Template("""<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><title>Настройка фильтров - lampa-filters</title>
<style>
body { font-family: -apple-system, sans-serif; background: #141519; color: #ddd; margin: 24px; }
h1 { font-size: 20px; }
fieldset { border: 1px solid #333; border-radius: 8px; margin: 0 0 16px; padding: 12px 16px; max-width: 900px; }
legend { color: #9cdcfe; padding: 0 6px; }
label { margin-right: 14px; }
input[type=number] { width: 90px; background: #1d1f23; color: #ddd; border: 1px solid #3a3d42; border-radius: 4px; padding: 4px 6px; }
select { background: #1d1f23; color: #ddd; border: 1px solid #3a3d42; border-radius: 4px; padding: 4px 6px; }
.genres { display: grid; grid-template-columns: repeat(4, minmax(150px, 1fr)); gap: 2px 10px; font-size: 13px; margin-top: 4px; }
.row { margin: 8px 0; }
button { background: #2d6cdf; border: 0; color: #fff; padding: 8px 16px; border-radius: 6px; cursor: pointer; margin-right: 8px; }
button.off { background: #8b3a3a; }
.note { color: #888; font-size: 12px; }
.status { margin: 6px 0 14px; } .ok { color: #4caf50; } .offstate { color: #e05252; }
a { color: #6ab0f3; }
</style></head><body>
<h1>Настройка фильтров</h1>
<div class="status" id="status">загрузка...</div>
<form id="form">
<fieldset><legend>Подборки (серверный фильтр: релизы, каталог, топ, коллекции)</legend>
<div class="row"><label><input type="checkbox" id="enabled"> Включить фильтр подборок</label></div>
<div class="row">Рейтинг от <input type="number" id="rating_min" step="0.1" min="0"> (0 = выкл), источник
<select id="rating_source"><option value="auto">auto (TMDB при 10+ голосах, иначе IMDb)</option><option value="tmdb">TMDB</option><option value="imdb">IMDb</option></select></div>
<div class="row">Годы: с <input type="number" id="year_from" min="1900" max="2100"> по <input type="number" id="year_to" min="1900" max="2100"> <span class="note">пусто = без ограничения</span></div>
<div class="row">Качество: <label><input type="checkbox" class="q" value="4k"> 4K</label><label><input type="checkbox" class="q" value="webdl"> webdl</label><label><input type="checkbox" class="q" value="bdrip"> bdrip</label> <span class="note">экранка (ts/tc) отсеивается всегда</span></div>
<div class="row"><label><input type="checkbox" id="keep_unknown_quality"> пропускать карточки без данных о качестве</label></div>
<div class="row">Исключить жанры (любое вхождение = мимо):<div class="genres" id="exclude_genres"></div></div>
<div class="row">Оставить только жанры (хотя бы один):<div class="genres" id="include_genres"></div></div>
<div class="row">Авто-выключение через <input type="number" id="expires_hours" min="0" step="1"> ч</div>
</fieldset>
<fieldset><legend>Избранное (клиентский фильтр, применяет плагин в Lampa)</legend>
<div class="row"><label><input type="checkbox" id="fav_enabled"> Фильтровать избранное</label> <span class="note">отдельные правила, не зависят от фильтра подборок</span></div>
<div class="row">Рейтинг от <input type="number" id="fav_rating_min" step="0.1" min="0">, источник <select id="fav_rating_source"><option value="auto">auto</option><option value="tmdb">TMDB</option><option value="imdb">IMDb</option></select></div>
<div class="row">Годы: с <input type="number" id="fav_year_from" min="1900" max="2100"> по <input type="number" id="fav_year_to" min="1900" max="2100"></div>
<div class="row">Качество: <label><input type="checkbox" class="favq" value="4k"> 4K</label><label><input type="checkbox" class="favq" value="webdl"> webdl</label><label><input type="checkbox" class="favq" value="bdrip"> bdrip</label></div>
<div class="row"><label><input type="checkbox" id="fav_keep_unknown_quality"> пропускать без данных о качестве</label></div>
<div class="row">Исключить жанры:<div class="genres" id="fav_exclude_genres"></div></div>
<div class="row">Оставить только жанры:<div class="genres" id="fav_include_genres"></div></div>
</fieldset>
<button type="submit">Сохранить</button>
<button type="button" class="off" id="btnOff">Выключить фильтр подборок сейчас</button>
</form>
<script>
var GENRES = $genres_json;
var DEFAULT_HOURS = $default_hours;
var CURRENT = {};

function num(id) { var v = document.getElementById(id).value; if (v === '') return null; var n = parseFloat(v); return isNaN(n) ? null : n; }
function setNum(id, value) { document.getElementById(id).value = (value === null || value === undefined) ? '' : value; }
function checks(container, ids) {
  container.innerHTML = '';
  Object.keys(GENRES).forEach(function (id) {
    var label = document.createElement('label');
    var box = document.createElement('input');
    box.type = 'checkbox'; box.value = id; box.checked = (ids || []).indexOf(parseInt(id, 10)) !== -1;
    label.appendChild(box); label.appendChild(document.createTextNode(' ' + GENRES[id] + ' (' + id + ')'));
    container.appendChild(label);
  });
}
function collect(container) {
  return Array.prototype.slice.call(container.querySelectorAll('input:checked')).map(function (b) { return parseInt(b.value, 10); });
}
function quality(cls) {
  return Array.prototype.slice.call(document.querySelectorAll('.' + cls + ':checked')).map(function (b) { return b.value; });
}
function setQuality(cls, list) {
  Array.prototype.forEach.call(document.querySelectorAll('.' + cls), function (b) { b.checked = (list || []).indexOf(b.value) !== -1; });
}
function renderStatus(f) {
  var text = f.enabled ? 'фильтр подборок: <span class="ok">ВКЛ</span>' : 'фильтр подборок: <span class="offstate">выкл</span>';
  if (f.enabled && f.expires_at) {
    var left = Math.max(0, Math.round(f.expires_at - Date.now() / 1000));
    text += ' (авто-выключение через ' + Math.floor(left / 3600) + ' ч ' + String(Math.floor((left % 3600) / 60)).padStart(2, '0') + ' мин)';
  }
  text += ' | избранное: ' + ((f.favorites && f.favorites.enabled) ? '<span class="ok">фильтруется</span>' : 'без фильтра');
  text += ' | <a href="/debug/releases">вердикты релизов</a> | <a href="/__mock/">лог</a> | <a href="/">фронт</a>';
  document.getElementById('status').innerHTML = text;
}
function fill(f) {
  CURRENT = f;
  document.getElementById('enabled').checked = !!f.enabled;
  setNum('rating_min', f.rating_min);
  document.getElementById('rating_source').value = f.rating_source || 'auto';
  setNum('year_from', f.year_from); setNum('year_to', f.year_to);
  setQuality('q', f.quality);
  document.getElementById('keep_unknown_quality').checked = !!f.keep_unknown_quality;
  checks(document.getElementById('exclude_genres'), f.exclude_genres);
  checks(document.getElementById('include_genres'), f.include_genres);
  document.getElementById('expires_hours').value = DEFAULT_HOURS;
  var fav = f.favorites || {};
  document.getElementById('fav_enabled').checked = !!fav.enabled;
  setNum('fav_rating_min', fav.rating_min || 0);
  document.getElementById('fav_rating_source').value = fav.rating_source || 'auto';
  setNum('fav_year_from', fav.year_from); setNum('fav_year_to', fav.year_to);
  setQuality('favq', fav.quality);
  document.getElementById('fav_keep_unknown_quality').checked = !!fav.keep_unknown_quality;
  checks(document.getElementById('fav_exclude_genres'), fav.exclude_genres);
  checks(document.getElementById('fav_include_genres'), fav.include_genres);
  renderStatus(f);
}
function load() {
  fetch('/filters').then(function (r) { return r.json(); }).then(fill);
}
document.getElementById('form').addEventListener('submit', function (e) {
  e.preventDefault();
  var payload = {
    enabled: document.getElementById('enabled').checked,
    rating_min: num('rating_min') || 0,
    rating_source: document.getElementById('rating_source').value,
    year_from: num('year_from'), year_to: num('year_to'),
    quality: quality('q'),
    keep_unknown_quality: document.getElementById('keep_unknown_quality').checked,
    exclude_genres: collect(document.getElementById('exclude_genres')),
    include_genres: collect(document.getElementById('include_genres')),
    expires_hours: num('expires_hours') || DEFAULT_HOURS,
    favorites: {
      enabled: document.getElementById('fav_enabled').checked,
      rating_min: num('fav_rating_min') || 0,
      rating_source: document.getElementById('fav_rating_source').value,
      year_from: num('fav_year_from'), year_to: num('fav_year_to'),
      quality: quality('favq'),
      keep_unknown_quality: document.getElementById('fav_keep_unknown_quality').checked,
      exclude_genres: collect(document.getElementById('fav_exclude_genres')),
      include_genres: collect(document.getElementById('fav_include_genres'))
    }
  };
  fetch('/filters', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    .then(function (r) { return r.json(); })
    .then(function (f) { fill(f); alert('Сохранено'); });
});
document.getElementById('btnOff').addEventListener('click', function () {
  fetch('/filters/off').then(function () { load(); });
});
load();
setInterval(function () {
  fetch('/filters').then(function (r) { return r.json(); }).then(function (f) { CURRENT = f; renderStatus(f); });
}, 30000);
</script>
</body></html>
""")


@app.get("/settings")
async def settings_page():
    page = SETTINGS_PAGE.substitute(genres_json=json.dumps(GENRES, ensure_ascii=False),
                                    default_hours=DEFAULT_EXPIRY_HOURS)
    return HTMLResponse(page)


@app.get("/filters")
async def filters_get():
    return dict(FILTERS, cache_gen=CACHE_GEN)


@app.post("/filters")
async def filters_post(request: Request):
    payload = await request.json()
    hours = payload.pop("expires_hours", DEFAULT_EXPIRY_HOURS)
    favorites = payload.pop("favorites", None)
    if isinstance(favorites, dict):
        FILTERS["favorites"].update(favorites)
    FILTERS.update(payload)
    if FILTERS.get("enabled") and hours:
        FILTERS["expires_at"] = time.time() + float(hours) * 3600
    else:
        FILTERS["expires_at"] = None
    clear_cache()
    note_request("/filters", 200, f"updated, enabled={FILTERS.get('enabled')}, авто-выключение через {hours} ч")
    return dict(FILTERS, cache_gen=CACHE_GEN)


@app.get("/filters/on")
async def filters_on():
    FILTERS["enabled"] = True
    FILTERS["expires_at"] = time.time() + DEFAULT_EXPIRY_HOURS * 3600
    clear_cache()
    note_request("/filters/on", 200, f"enabled=True, авто-выключение через {DEFAULT_EXPIRY_HOURS} ч")
    return dict(FILTERS, cache_gen=CACHE_GEN)


@app.get("/filters/off")
async def filters_off():
    FILTERS["enabled"] = False
    FILTERS["expires_at"] = None
    clear_cache()
    note_request("/filters/off", 200, "enabled=False")
    return dict(FILTERS, cache_gen=CACHE_GEN)


@app.get("/__mock/")
async def index():
    rows = "".join(f"<tr><td><code>{line}</code></td></tr>" for line in reversed(LOG))
    rows = rows or "<tr><td>запросов пока не было</td></tr>"
    state = "ВКЛ" if FILTERS.get("enabled") else "выкл"
    prefetch = f"предзагрузка: {PREFETCH_AHEAD} страниц, кэш TTL {CACHE_TTL} c"
    html = f"""<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<meta http-equiv="refresh" content="3">
<title>lampa-filters mock</title>
<style>
body {{ font-family: -apple-system, sans-serif; background: #141519; color: #ddd; margin: 24px; }}
h1 {{ font-size: 20px; }} .ok {{ color: #4caf50; }} code {{ color: #9cdcfe; }}
table {{ border-collapse: collapse; margin-top: 12px; }} td {{ padding: 3px 10px 3px 0; font-size: 13px; }}
</style></head><body>
<h1>lampa-filters mock - жив <span class="ok">({state} фильтр, {stats['total']} запросов)</span></h1>
<p>настройка фильтров: <a href="/settings">/settings</a> | фронт Lampa: <a href="/">http://127.0.0.1:{MOCK_PORT}/</a></p>
<p>пресет: <code>/filters</code>, вкл: <code>/filters/on</code>, выкл: <code>/filters/off</code> | {prefetch}</p>
<table>{rows}</table>
</body></html>"""
    return HTMLResponse(html)


if MIRROR_DIR.is_dir():
    app.mount("/", StaticFiles(directory=str(MIRROR_DIR), html=True), name="mirror")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=MOCK_PORT, log_level="warning")
