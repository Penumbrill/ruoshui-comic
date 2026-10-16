"""
标签工具模块 - Danbooru API 调用 + 标签分类逻辑
"""
import re
import time
import threading
import logging

import requests
import urllib3

# 本地标签数据库（可选）
try:
    from . import tag_db
    HAS_TAG_DB = True
except ImportError:
    HAS_TAG_DB = False

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# 尝试多种方式绕过 CDN（cloudscraper / curl_cffi）
HAS_CLOUDSCRAPER = False
_CDN_SESSION = None

# 方式 1: curl_cffi (最推荐 — 完美模拟浏览器 TLS)
try:
    from curl_cffi import requests as cffer
    _CDN_SESSION = cffer.Session()
    _CDN_MODE = "curl_cffi"
except ImportError:
    # 方式 2: cloudscraper
    try:
        import cloudscraper
        _CDN_SESSION = cloudscraper.create_scraper()
        _CDN_MODE = "cloudscraper"
        HAS_CLOUDSCRAPER = True
    except ImportError:
        _CDN_SESSION = None
        _CDN_MODE = "requests"

BASE_URL = "https://danbooru.donmai.us"

# Danbooru API 要求描述性 UA（不能用 python-requests 默认的）
# CDN 图片需要浏览器风格 UA，分开使用
API_UA = "DanbooruAnimaPrompt/1.0 (Anime tag classifier)"
CDN_UA = "Danbooru-Gallery/1.0"  # 简单描述性 UA 才能过 CF（Chrome UA 被 403）

API_HEADERS = {
    "User-Agent": API_UA,
    "Accept": "application/json",
}

CDN_HEADERS = {
    "User-Agent": CDN_UA,
    "Accept": "image/webp,image/avif,image/png,image/jpeg,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Referer": "https://danbooru.donmai.us/",
}

# ── 内存缓存（避免重复请求） ────────────────────────────
_cache = {}
_cache_lock = threading.Lock()

def _cache_get(key):
    with _cache_lock:
        entry = _cache.get(key)
        if entry and time.monotonic() - entry["ts"] < 300:  # 5 分钟过期
            return entry["val"]
    return None

def _cache_set(key, val):
    with _cache_lock:
        _cache[key] = {"val": val, "ts": time.monotonic()}

def _cache_clear():
    with _cache_lock:
        _cache.clear()


# ── 限流器 ──────────────────────────────────────────
class _RateLimiter:
    def __init__(self, min_interval_sec=0.2):
        self.min_interval = min_interval_sec
        self._last_ts = 0.0
        self._lock = threading.Lock()

    def wait(self):
        with self._lock:
            now = time.monotonic()
            elapsed = now - self._last_ts
            if elapsed < self.min_interval:
                time.sleep(self.min_interval - elapsed)
            self._last_ts = time.monotonic()

_donmai_throttle = _RateLimiter(min_interval_sec=0.2)


def _request(method, url, **kwargs):
    """跟 D 站画廊一样：简单 requests → 限流 + UA + 429/503 重试"""
    headers = dict(kwargs.pop("headers", None) or {})
    is_cdn = "cdn." in url
    for k, v in (CDN_HEADERS if is_cdn else API_HEADERS).items():
        headers.setdefault(k, v)
    verify = kwargs.pop("verify", True)
    to = kwargs.pop("timeout", None) or 10

    for attempt in range(2):
        _donmai_throttle.wait()
        try:
            resp = requests.request(method, url, headers=headers, timeout=to, verify=verify, **kwargs)
            if resp.status_code not in (429, 503) or attempt == 1:
                return resp
            retry_after = resp.headers.get("Retry-After")
            delay = min(max(float(retry_after or "2"), 0.5), 10.0)
            time.sleep(delay)
        except requests.exceptions.RequestException:
            if attempt == 1:
                raise
            time.sleep(1)
    return resp


# ── Danbooru API 封装 ──────────────────────────────

def search_posts(tags, page=1, limit=20, rating=None, order=None):
    """搜索帖子，返回帖子列表"""
    # order 参数前插，确保可以被 tags 中的 order:xxx 覆盖
    q = f"order:{order} {tags}" if order else tags
    params = {
        "tags": q,
        "page": page,
        "limit": min(limit, 100),
    }
    # 分级：单值直接过滤，多值排除未选的分级（确保 OR 语义）
    if rating:
        if isinstance(rating, list) and rating:
            valid = [r for r in rating if r]
            if len(valid) == 1:
                params["tags"] += f" rating:{valid[0]}"
            elif len(valid) > 1:
                exclude = [x for x in ("general", "sensitive", "questionable", "explicit") if x not in valid]
                params["tags"] += " " + " ".join(f"-rating:{x}" for x in exclude)
        elif isinstance(rating, str):
            vals = [r.strip().lower() for r in rating.split(",") if r.strip()]
            if len(vals) == 1:
                params["tags"] += f" rating:{vals[0]}"
            elif len(vals) > 1:
                exclude = [x for x in ("general", "sensitive", "questionable", "explicit") if x not in vals]
                if exclude:
                    params["tags"] += " " + " ".join(f"-rating:{x}" for x in exclude)

    url = f"{BASE_URL}/posts.json"
    resp = _request("GET", url, params=params)
    if resp.status_code == 200:
        return resp.json()
    return []


def get_post_detail(post_id):
    """获取单帖完整信息（含 tags 和 tag_string_*），带缓存"""
    cache_key = f"post:{post_id}"
    cached = _cache_get(cache_key)
    if cached:
        return cached

    url = f"{BASE_URL}/posts/{post_id}.json"
    resp = _request("GET", url)
    if resp.status_code == 200:
        data = resp.json()
        _cache_set(cache_key, data)
        return data
    print(f"[DanbooruAnima] get_post_detail({post_id}) 失败: HTTP {resp.status_code}")
    return None


def get_tag_categories_batch(tag_names, use_local_db=True):
    """
    批量查询 tag 的 category。
    优先查本地数据库（如果可用），未命中的再调 API。
    
    Args:
        tag_names: list[str]
        use_local_db: 是否启用本地数据库查询
        
    Returns:
        dict: {tag_name: category_id}
        category_id: 0=general, 1=artist, 3=copyright, 4=character, 5=meta
    """
    if not tag_names:
        return {}

    # ── 第 1 步：查本地数据库 ──
    local_hits = {}
    remaining = tag_names
    if use_local_db and HAS_TAG_DB:
        try:
            local_hits = tag_db.batch_lookup(tag_names)
            if local_hits:
                remaining = [t for t in tag_names if t not in local_hits]
                if not remaining:
                    return local_hits
        except Exception as e:
            print(f"[DanbooruAnima] 本地数据库查询失败，降级到 API: {e}")

    # ── 第 2 步：查内存缓存（只查 remaining） ──
    cache_hits = {}
    still_remaining = list(remaining)
    if remaining:
        for tag in list(remaining):
            cached = _cache_get(f"cat:{tag}")
            if cached is not None:
                cache_hits[tag] = cached
                still_remaining.remove(tag)

    if not still_remaining:
        result = {**local_hits, **cache_hits}
        return result

    # ── 第 3 步：调 API 查仍未命中的标签 ──
    api_result = {}
    try:
        names_str = ",".join(still_remaining)
        url = f"{BASE_URL}/tags.json"
        params = {
            "search[name_normalize]": names_str,
            "limit": min(len(still_remaining), 200),
        }
        resp = _request("GET", url, params=params)
        if resp.status_code == 200:
            data = resp.json()
            for tag in data:
                api_result[tag["name"]] = tag.get("category", 0)
        # 未返回的 tag 默认先留空，让语义引擎尝试
        for name in still_remaining:
            api_result.setdefault(name, None)

        # 写入缓存（仅缓存 API 确定的）
        for name, cat in api_result.items():
            if cat is not None:
                _cache_set(f"cat:{name}", cat)
    except Exception as e:
        print(f"[DanbooruAnima] API 分类查询失败: {e}")
        # API 失败时，标记所有剩余标签为待语义推断
        for name in still_remaining:
            api_result[name] = None

    # ── 第 3.5 步：语义引擎推断 fallback（API 未返回分类的标签） ──
    semantic_candidates = [name for name, cat in api_result.items() if cat is None]
    if semantic_candidates:
        try:
            from .tag_engine import DanbooruTagger
            tagger = DanbooruTagger._instance
            if tagger and tagger.is_loaded:
                for name in semantic_candidates:
                    guessed = tagger.guess_category(name)
                    if guessed is not None:
                        api_result[name] = guessed
                        _cache_set(f"cat:{name}", guessed)
        except Exception:
            pass  # 语义引擎不可用时不报错

    # 仍未推断出的标记为 general (0)
    for name in semantic_candidates:
        if api_result.get(name) is None:
            api_result[name] = 0

    result = {**local_hits, **cache_hits, **api_result}
    return result


# ── 标签分类规则 ────────────────────────────────────

# 计数类标签模式
COUNT_TAG_PATTERN = re.compile(r'^\d+(girl|boy|other|people|furry|animal|pony|corgi|sad|soldier|ninja|robot|monster|alien|demon|angel|youkai|spirit|dragon|cat|dog|fox|wolf|mouse|bird|fish|bug|plant|food|object|train|car|plane|boat|sword|gun|bow|arrow|wand|staff|hammer|axe|knife|spear|shield)s?$', re.IGNORECASE)

COUNT_TAGS = {
    "no_humans", "no_girls", "no_boys", "solo", "multiple_girls", "multiple_boys",
    "female", "male", "ambiguous_gender", "gender_ambiguous",
    "group", "duo", "trio", "monochrome", "greyscale",
}

# 质量/元标签关键词
META_KEYWORDS = {
    "masterpiece", "best_quality", "highres", "absurdres", "ultra_highres",
    "lowres", "worst_quality", "bad_quality", "normal_quality",
    "fractal", "scan", "photoshop", "digital_media", "traditional_media",
    "watermark", "signature", "artist_name", "commission",
    "translated", "commentary", "commentary_request", "translation_request",
}

# 年份正则
YEAR_PATTERN = re.compile(r'^\d{4}$')


def classify_tag(tag_name, category_id=None):
    """
    对单个 tag 进行分类，返回 Anima 分组名称。
    
    返回: "quality_meta" | "count" | "character" | "series" | "artist" | "general"
    """
    name = tag_name.strip().lower()
    
    # 1. 如果有 API category，优先使用
    if category_id is not None:
        if category_id == 1:
            return "artist"
        elif category_id == 4:
            return "character"
        elif category_id == 3:
            return "series"
        elif category_id == 5:
            return "quality_meta"

    # 2. rating: 前缀 → quality_meta
    if name.startswith("rating:"):
        return "quality_meta"

    # 3. 计数类标签
    if COUNT_TAG_PATTERN.match(name) or name in COUNT_TAGS:
        return "count"

    # 4. 质量关键词
    if name in META_KEYWORDS:
        return "quality_meta"

    # 5. 年份
    if YEAR_PATTERN.match(name):
        return "quality_meta"

    # 6. 默认归为 general
    return "general"


def classify_tags(tag_list, category_map=None):
    """
    对标签列表进行分类。
    
    Args:
        tag_list: list of str, 标签名列表
        category_map: dict {tag_name: category_id}, 来自 API 查询
        
    Returns:
        dict: {
            "quality_meta": [...],
            "count": [...],
            "character": [...],
            "series": [...],
            "artist": [...],
            "general": [...],
            "all": [...]
        }
    """
    if category_map is None:
        category_map = {}

    groups = {
        "quality_meta": [],
        "count": [],
        "character": [],
        "series": [],
        "artist": [],
        "general": [],
        "all": list(tag_list),
    }

    for tag in tag_list:
        tag = tag.strip()
        if not tag:
            continue
        cat = category_map.get(tag)
        group = classify_tag(tag, cat)
        groups[group].append(tag)

    return groups