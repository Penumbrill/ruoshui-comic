
import json
import os
import time
import shutil
import hashlib
import asyncio
import base64
import requests

# 图片代理信号量（限制并发，避免触发 CF 限流，跟 D 站画廊一致）
_image_proxy_semaphore = None

def _get_image_proxy_semaphore():
    global _image_proxy_semaphore
    if _image_proxy_semaphore is None:
        _image_proxy_semaphore = asyncio.Semaphore(3)
    return _image_proxy_semaphore
from requests.adapters import HTTPAdapter
from io import BytesIO

import torch
import numpy as np
from PIL import Image
from server import PromptServer
from aiohttp import web

from .tag_utils import search_posts, get_post_detail, get_tag_categories_batch, classify_tags, _request
from .config import load_settings, save_settings

import threading

# ── 分类数据缓存（避免每次点 🔍 都去 D 站查 tag category） ──
_classified_cache = {}
_classified_cache_lock = threading.Lock()
_classifying_posts = set()
_classifying_posts_lock = threading.Lock()

# ── 模糊搜索缓存（内存 LRU，10 分钟过期） ─────────────
import csv
_fuzzy_cache = {}
_fuzzy_cache_lock = threading.Lock()

def _get_cached(query):
    with _fuzzy_cache_lock:
        entry = _fuzzy_cache.get(query)
        if entry and time.monotonic() - entry["ts"] < 600:
            return entry["data"]
        if entry:
            del _fuzzy_cache[query]
    return None

def _set_cached(query, data):
    with _fuzzy_cache_lock:
        _fuzzy_cache[query] = {"data": data, "ts": time.monotonic()}
        if len(_fuzzy_cache) > 200:
            for k in list(_fuzzy_cache.keys())[:50]:
                del _fuzzy_cache[k]

# ── 中文→英文本地索引 ─────────────────────────────
_CN_INDEX = {}
_EN_TO_CN = {}
_CN_INDEX_LOADED = False
_CHAR_INDEX = {}

# ── 内置常用中文→英文角色名映射（确保即使无外部文件也能搜到常见角色） ──
_BUILTIN_CN_MAP = {
    "阿米娅": ["amiya_(arknights)"],
    "能天使": ["exusiai_(arknights)"],
    "德克萨斯": ["texas_(arknights)"],
    "拉普兰德": ["lappland_(arknights)"],
    "银灰": ["silverash_(arknights)"],
    "艾雅法拉": ["eyjafjalla_(arknights)"],
    "伊芙利特": ["ifrit_(arknights)"],
    "塞雷娅": ["saria_(arknights)"],
    "星熊": ["hoshiguma_(arknights)"],
    "推进之王": ["siege_(arknights)"],
    "夜莺": ["nightingale_(arknights)"],
    "闪灵": ["shining_(arknights)"],
    "洁哥": ["angelina_(arknights)"],
    "安洁莉娜": ["angelina_(arknights)"],
    "小火龙": ["ifrit_(arknights)"],
    "煌": ["blaze_(arknights)"],
    "棘刺": ["thorns_(arknights)"],
    "山": ["mountain_(arknights)"],
    "史尔特尔": ["surtr_(arknights)"],
    "42": ["surtr_(arknights)"],
    "凯尔希": ["kal'tsit_(arknights)"],
    "W": ["w_(arknights)"],
    "浊心斯卡蒂": ["skadi_the_corrupting_heart_(arknights)"],
    "斯卡蒂": ["skadi_(arknights)"],
    "歌蕾蒂娅": ["gladiia_(arknights)"],
    "归溟幽灵鲨": ["specter_the_unchained_(arknights)"],
    "幽灵鲨": ["specter_(arknights)"],
    "羽毛笔": ["la_pluma_(arknights)"],
    "号角": ["horn_(arknights)"],
    "风笛": ["bagpipe_(arknights)"],
    "琴柳": ["saileach_(arknights)"],
    "嵯峨": ["saga_(arknights)"],
    "焰尾": ["flametail_(arknights)"],
    "灰毫": ["ashlock_(arknights)"],
    "野鬃": ["wildmane_(arknights)"],
    "远牙": ["fartooth_(arknights)"],
    "弦惊": ["fartooth_(arknights)"],
    "灰烬": ["ash_(arknights)"],
    "霜华": ["frost_(arknights)"],
    "闪击": ["blitz_(arknights)"],
    "战车": ["tachanka_(arknights)"],
    "水陈": ["ch'en_the_holungday_(arknights)"],
    "假日威龙陈": ["ch'en_the_holungday_(arknights)"],
    "陈": ["ch'en_(arknights)"],
    "塔露拉": ["talulah_(arknights)"],
    "霜星": ["frostnova_(arknights)"],
    "爱国者": ["patriot_(arknights)"],
    "M3": ["m3_(arknights)"],
    "红蒂": ["skadi_the_corrupting_heart_(arknights)"],
    "水月": ["mizuki_(arknights)"],
    "归鲨": ["specter_the_unchained_(arknights)"],
    "异德": ["texas_the_omertosa_(arknights)"],
    "缪缪": ["muelsyse_(arknights)"],
    "缪尔赛思": ["muelsyse_(arknights)"],
    "伊芙琳": ["evelyn_(league_of_legends)", "evelynn"],
    "乐芙兰": ["leblanc_(league_of_legends)"],
    "阿狸": ["ahri_(league_of_legends)"],
    "金克丝": ["jinx_(league_of_legends)"],
    "拉克丝": ["lux_(league_of_legends)"],
    "卡莎": ["kai'sa_(league_of_legends)"],
    "阿卡丽": ["akali_(league_of_legends)"],
    "亚索": ["yasuo_(league_of_legends)"],
    "艾希": ["ashe_(league_of_legends)"],
    "蕾姆": ["rem_(re:zero)"],
    "拉姆": ["ram_(re:zero)"],
    "爱蜜莉雅": ["emilia_(re:zero)"],
    "碧蓝档案": ["blue_archive"],
    "ba": ["blue_archive"],
    "初音未来": ["hatsune_miku"],
    "miku": ["hatsune_miku"],
    "甘雨": ["ganyu_(genshin_impact)"],
    "刻晴": ["keqing_(genshin_impact)"],
    "胡桃": ["hu_tao_(genshin_impact)"],
    "雷电将军": ["raiden_shogun_(genshin_impact)"],
    "纳西妲": ["nahida_(genshin_impact)"],
    "草神": ["nahida_(genshin_impact)"],
    "芙宁娜": ["furina_(genshin_impact)"],
    "水神": ["furina_(genshin_impact)"],
    "九条裟罗": ["kujou_sara_(genshin_impact)"],
    "八重神子": ["yae_miko_(genshin_impact)"],
    "神里绫华": ["kamisato_ayaka_(genshin_impact)"],
    "绫华": ["kamisato_ayaka_(genshin_impact)"],
    "琪亚娜": ["kiana_(honkai_impact_3rd)"],
    "布洛妮娅": ["bronya_(honkai_impact_3rd)"],
    "希儿": ["seele_(honkai_impact_3rd)"],
    "板鸭": ["bronya_(honkai_impact_3rd)"],
    "爱莉希雅": ["elysia_(honkai_impact_3rd)"],
    "屑狐狸": ["yae_miko_(genshin_impact)"],
    "派蒙": ["paimon_(genshin_impact)"],
}

def _load_builtin_index():
    """将内置映射加载到 _CN_INDEX"""
    for cn_name, en_tags in _BUILTIN_CN_MAP.items():
        for en_tag in en_tags:
            _CN_INDEX.setdefault(cn_name.strip(), []).append(en_tag)

def _try_copy_from_gallery(our_dir, fn):
    """从 D 站画廊（如果装了的话）复制中文数据"""
    my_dir = os.path.dirname(os.path.abspath(__file__))
    gallery_paths = [
        os.path.abspath(os.path.join(my_dir, "..", "..", "ComfyUI-Danbooru-Gallery", "py", "danbooru_gallery", "zh_cn")),
    ]
    for gp in gallery_paths:
        gfp = os.path.join(gp, fn)
        if os.path.isfile(gfp):
            import shutil
            shutil.copy2(gfp, os.path.join(our_dir, fn))
            return True
    return False

# 多源下载：国内镜像优先，直连 GitHub 兜底
_ZH_URLS = {
    "all_tags_cn.json": [
        "https://ghproxy.com/https://raw.githubusercontent.com/zhangtianruo/ComfyUI-Danbooru-Gallery/main/py/danbooru_gallery/zh_cn/all_tags_cn.json",
    ],
    "wai_characters.csv": [
        "https://ghproxy.com/https://raw.githubusercontent.com/zhangtianruo/ComfyUI-Danbooru-Gallery/main/py/danbooru_gallery/zh_cn/wai_characters.csv",
    ],
}

def _download_zh_cn(url, dest_path):
    """下载单个中文数据文件"""
    try:
        resp = requests.get(url, timeout=15)
        if resp.status_code == 200:
            os.makedirs(os.path.dirname(dest_path), exist_ok=True)
            with open(dest_path, "wb") as f:
                f.write(resp.content)
            return True
    except Exception:
        pass
    return False

def _ensure_cn_index(force_reload=False):
    global _CN_INDEX, _CN_INDEX_LOADED, _CHAR_INDEX
    if _CN_INDEX_LOADED and not force_reload:
        return

    # 1) 加载内置映射（不需要任何人，永远可用）
    _load_builtin_index()

    # 2) 优先从 D 站画廊复制完整数据
    my_dir = os.path.dirname(os.path.abspath(__file__))
    our_data_dir = os.path.join(my_dir, "zh_cn")
    os.makedirs(our_data_dir, exist_ok=True)

    gallery_path = os.path.abspath(os.path.join(my_dir, "..", "..", "ComfyUI-Danbooru-Gallery", "py", "danbooru_gallery", "zh_cn"))
    for fn in ["all_tags_cn.json", "wai_characters.csv"]:
        fp = os.path.join(our_data_dir, fn)
        if not os.path.isfile(fp):
            # 尝试画廊复制
            ok = _try_copy_from_gallery(our_data_dir, fn)
            if not ok:
                # 再试在线下载
                for url in _ZH_URLS.get(fn, []):
                    ok = _download_zh_cn(url, fp)
                    if ok:
                        break

    # 3) 读取数据
    src_dir = our_data_dir if os.path.isdir(our_data_dir) else None
    if src_dir:
        jp = os.path.join(src_dir, "all_tags_cn.json")
        if os.path.isfile(jp):
            try:
                with open(jp, "r", encoding="utf-8") as f:
                    for en_tag, cn_name in json.load(f).items():
                        if cn_name and en_tag:
                            _CN_INDEX.setdefault(cn_name.strip(), []).append(en_tag)
            except Exception:
                pass

        # 读角色 CSV（中→英）
        cp = os.path.join(src_dir, "wai_characters.csv")
        if os.path.isfile(cp):
            try:
                with open(cp, "r", encoding="utf-8") as f:
                    for row in csv.reader(f):
                        if len(row) >= 2 and row[0].strip() and row[1].strip():
                            _CN_INDEX.setdefault(row[0].strip(), []).append(row[1].strip())
            except Exception:
                pass

    # 4) 从 tags_enhanced.csv 加载海量中文名（50,116 条）
    _csv_paths = [
        os.path.join(os.path.dirname(my_dir), "tags_enhanced.csv"),   # 插件根目录
        os.path.join(my_dir, "..", "..", "tags_enhanced.csv"),
    ]
    for csvp in _csv_paths:
        csvp = os.path.normpath(csvp)
        if not os.path.isfile(csvp):
            continue
        # 自动检测编码
        _enc = None
        for _e in ["utf-8", "utf-8-sig", "gbk", "gb2312", "latin-1", "cp1252"]:
            try:
                with open(csvp, "r", encoding=_e) as f:
                    f.read(1024)
                _enc = _e
                break
            except (UnicodeDecodeError, UnicodeError):
                continue
        if _enc is None:
            continue
        try:
            loaded = 0
            with open(csvp, "r", encoding=_enc, newline="") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    en_tag = row.get("name", "").strip()
                    cn_raw = row.get("cn_name", "").strip()
                    if not en_tag or not cn_raw:
                        continue
                    # cn_name 可能是逗号分隔的多个翻译
                    cn_parts = [c.strip() for c in cn_raw.split(",") if c.strip()]
                    # 填入中→英索引（_EN_TO_CN 稍后会自动重建）
                    for cn_part in cn_parts:
                        _CN_INDEX.setdefault(cn_part, [])
                        if en_tag not in _CN_INDEX[cn_part]:
                            _CN_INDEX[cn_part].append(en_tag)
                    loaded += 1
            if loaded:
                print(f"[DanbooruAnima] tags_enhanced.csv 中文名加载完成: {loaded} 条")
            break  # 找到第一个有效文件后退出
        except Exception as e:
            print(f"[DanbooruAnima] 加载 tags_enhanced.csv 中文名失败: {e}")
            continue

    # 读持久化的英→中映射（保存的是正确的 cn_name，不是搜索词）
    pm = os.path.join(my_dir, "persist_cn.json")
    if os.path.isfile(pm):
        try:
            with open(pm, "r", encoding="utf-8") as f:
                for en_tag, cn_name in json.load(f).items():
                    if cn_name:
                        _CN_INDEX.setdefault(cn_name, [])
                        if en_tag not in _CN_INDEX[cn_name]:
                            _CN_INDEX[cn_name].append(en_tag)
        except Exception:
            pass

    # 建立英→中反向索引（选专属度最高的翻译）
    # 一个中文词对应的英文标签越少，越可能是专有翻译而非分类标签
    global _EN_TO_CN
    _EN_TO_CN.clear()
    _cn_sp = {}  # 记录每个 en_tag 当前最佳翻译的专属度
    for cn_name, en_tags in _CN_INDEX.items():
        specificity = len(en_tags)  # 越小越专有
        for en_tag in en_tags:
            prev_sp = _cn_sp.get(en_tag)
            if prev_sp is None or specificity < prev_sp:
                _EN_TO_CN[en_tag] = cn_name
                _cn_sp[en_tag] = specificity

    _CN_INDEX_LOADED = True
    total = sum(len(v) for v in _CN_INDEX.values())

    # 字符索引
    _CHAR_INDEX.clear()
    for cn_name in list(_CN_INDEX.keys()):
        for ch in cn_name:
            if '\u4e00' <= ch <= '\u9fff':
                _CHAR_INDEX.setdefault(ch, set()).add(cn_name)

    print(f"[DanbooruAnima] 中文索引就绪: {len(_CN_INDEX)} 词条, {total} 标签, {len(_CHAR_INDEX)} 汉字, 来源={src_dir or '无'}")

def _search_local(query):
    """本地中文索引搜索 + 英文前缀搜索"""
    _ensure_cn_index()
    query_lower = query.lower()
    query_chars = [c for c in query if '\u4e00' <= c <= '\u9fff']

    results = []
    seen_tags = set()

    # 英文搜索
    if not query_chars:
        for tag in _EN_TO_CN:
            if tag.startswith(query_lower) or query_lower in tag:
                cn = _EN_TO_CN[tag]
                if tag not in seen_tags:
                    seen_tags.add(tag)
                    results.append({"tag": tag, "cn": cn, "src": "本地"})
                    if len(results) >= 20:
                        break
        return results[:15]

    # 方法一：字符索引精确交集（快）
    candidates = None
    all_chars_present = True
    for ch in query_chars:
        s = _CHAR_INDEX.get(ch)
        if not s:
            all_chars_present = False
            break
        if candidates is None:
            candidates = s.copy()
        else:
            candidates &= s

    if all_chars_present and candidates:
        for cn_name in candidates:
            if query not in cn_name:
                continue
            for tag in _CN_INDEX.get(cn_name, []):
                if tag not in seen_tags:
                    seen_tags.add(tag)
                    results.append({"tag": tag, "cn": cn_name, "src": "本地"})
                    if len(results) >= 10:
                        return results

    # ── 语义搜索 fallback（字符索引没结果时启用） ──
    if not results:
        try:
            from .tag_engine import DanbooruTagger
            tagger = DanbooruTagger._instance
            if tagger and tagger.is_loaded:
                semantic = tagger.semantic_search(query, top_k=10, score_threshold=0.2)
                for item in semantic:
                    tag = item["name"]
                    if tag not in seen_tags:
                        seen_tags.add(tag)
                        results.append({
                            "tag": tag,
                            "cn": item.get("cn_name", ""),
                            "src": "语义",
                            "score": item.get("score", 0),
                        })
        except Exception:
            pass

    return results

def _save_persist_cn(en_tag, cn_name):
    """持久化保存单个英→中映射，重启不丢"""
    my_dir = os.path.dirname(os.path.abspath(__file__))
    pm = os.path.join(my_dir, "persist_cn.json")
    try:
        data = {}
        if os.path.isfile(pm):
            with open(pm, "r", encoding="utf-8") as f:
                data = json.load(f)
        if en_tag not in data:
            data[en_tag] = cn_name
            with open(pm, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception:
        pass

# ── CDN 连接池 + 磁盘缓存（加速图片加载） ───────────
_CDN_SESSION = requests.Session()
_CDN_SESSION.headers.update({"User-Agent": "Danbooru-Gallery/1.0"})
_cdn_adapter = HTTPAdapter(pool_connections=20, pool_maxsize=20, max_retries=2)
_CDN_SESSION.mount("https://", _cdn_adapter)

_CDN_CACHE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cdn_cache")

def _clean_old_cache():
    """清理缓存：小图（≤512KB）保留 24h，大图保留 1h；总大小超 300MB 时删最大文件"""
    try:
        now = time.time()
        total_size = 0
        files_info = []
        for fname in os.listdir(_CDN_CACHE_DIR):
            fpath = os.path.join(_CDN_CACHE_DIR, fname)
            if not os.path.isfile(fpath):
                continue
            sz = os.path.getsize(fpath)
            total_size += sz
            age = now - os.path.getmtime(fpath)
            # 大图（>512KB）超过 1h 删；小图超过 24h 删
            max_age = 3600 if sz > 512 * 1024 else 86400
            if age > max_age:
                os.remove(fpath)
            else:
                files_info.append((sz, fpath, os.path.getmtime(fpath)))
        # 总大小 > 300MB 时，从大到小删到 200MB 以下
        if total_size > 300 * 1024 * 1024:
            files_info.sort(key=lambda x: -x[0])
            target = 200 * 1024 * 1024
            for sz, fpath, _ in files_info:
                if total_size <= target:
                    break
                os.remove(fpath)
                total_size -= sz
    except Exception:
        pass

_clean_old_cache()
os.makedirs(_CDN_CACHE_DIR, exist_ok=True)

def _cdn_cache_path(url):
    """根据 URL 返回磁盘缓存路径"""
    ext = os.path.splitext(url)[1] or ".jpg"
    return os.path.join(_CDN_CACHE_DIR, hashlib.md5(url.encode()).hexdigest() + ext)

# 启动时预建中文索引，避免第一次点按钮时卡住
_ensure_cn_index()

# ── 帖子详情缓存（5 分钟过期，避免预加载和 browse 重复请求） ──
_post_cache = {}
_post_cache_lock = threading.Lock()

def _get_post_cached(post_id):
    """带缓存的 get_post_detail"""
    with _post_cache_lock:
        entry = _post_cache.get(post_id)
        if entry and time.monotonic() - entry["ts"] < 300:
            return entry["data"]
    # 缓存未命中，调用原始函数
    data = get_post_detail(post_id)
    if data:
        with _post_cache_lock:
            _post_cache[post_id] = {"data": data, "ts": time.monotonic()}
            if len(_post_cache) > 100:
                for k in list(_post_cache.keys())[:20]:
                    del _post_cache[k]
    return data

# ── browse() 完整结果缓存（点图时预计算，Run 时秒出） ──
_result_cache = {}
_result_cache_lock = threading.Lock()
_building_events = {}  # post_id → Event
_building_lock = threading.Lock()

def _precache_browse(post_id, original_resolution=True):
    """提前计算 browse()。若另一线程正在构建，等待它完成"""
    cache_key = (post_id, original_resolution)
    # 快速路径：已有缓存
    with _result_cache_lock:
        if cache_key in _result_cache:
            return _result_cache[cache_key]

    # 检查是否有线程已在构建
    with _building_lock:
        if post_id in _building_events:
            evt = _building_events[post_id]
            # 等它建完
            evt.wait(timeout=10)
            with _result_cache_lock:
                return _result_cache.get(cache_key)
        else:
            # 自己来建
            evt = threading.Event()
            _building_events[post_id] = evt

    try:
        post = _get_post_cached(post_id)
        if not post:
            return None

        tag_string = post.get("tag_string", "")
        tags = [t.strip() for t in tag_string.split() if t.strip()]
        category_map = get_tag_categories_batch(tags)
        groups = classify_tags(tags, category_map)

        # 下载图片（优先 media_asset.variants 高清封面帧 → 磁盘缓存 → 原图）
        image_tensor = None

        # 视频/GIF 帖走 media_asset.variants
        if post.get("file_ext", "") in ("mp4", "webm", "gif") or "ugoira" in post.get("tag_string", ""):
            ma = post.get("media_asset", {}) or {}
            variants = [v for v in (ma.get("variants", []) if isinstance(ma, dict) else []) if v.get("type", "") not in ("original",)]
            if variants:
                def sk(v):
                    w = v.get("width", 0) or 0
                    return -w
                variants.sort(key=sk)
            for v in variants:
                u = v.get("url", "")
                if not u:
                    continue
                cp = _cdn_cache_path(u)
                try:
                    if os.path.isfile(cp):
                        try:
                            with open(cp, "rb") as f:
                                img = Image.open(f).convert("RGB")
                                image_tensor = torch.from_numpy(np.array(img).astype(np.float32) / 255.0)[None,]
                                break
                        except Exception:
                            os.remove(cp)  # 缓存损坏，删了重下
                    resp = _CDN_SESSION.get(u, timeout=5, verify=False)
                    if resp.status_code == 200:
                        try:
                            with open(cp, "wb") as f:
                                f.write(resp.content)
                        except Exception:
                            pass
                        try:
                            img = Image.open(BytesIO(resp.content)).convert("RGB")
                            image_tensor = torch.from_numpy(np.array(img).astype(np.float32) / 255.0)[None,]
                            break
                        except Exception:
                            continue
                except Exception:
                    continue

        # 普通图片或视频回退 — 根据设置选原图或 sample
        if image_tensor is None:
            if original_resolution:
                cdn = post.get("file_url") or post.get("large_file_url") or post.get("preview_file_url") or ""
            else:
                cdn = post.get("large_file_url") or post.get("file_url") or post.get("preview_file_url") or ""
            if cdn:
                try:
                    # 先查磁盘缓存
                    cache_path = _cdn_cache_path(cdn)
                    if os.path.isfile(cache_path):
                        with open(cache_path, "rb") as f:
                            img = Image.open(f).convert("RGB")
                            image_tensor = torch.from_numpy(np.array(img).astype(np.float32) / 255.0)[None,]
                    else:
                        resp = _CDN_SESSION.get(cdn, timeout=5, verify=False)
                        if resp.status_code == 200:
                            try:
                                with open(cache_path, "wb") as f:
                                    f.write(resp.content)
                            except Exception:
                                pass
                            img = Image.open(BytesIO(resp.content)).convert("RGB")
                            image_tensor = torch.from_numpy(np.array(img).astype(np.float32) / 255.0)[None,]
                except Exception:
                    pass

        result = {
            "image": image_tensor,
            "all": ", ".join(groups["all"]),
            "quality_meta": ", ".join(groups["quality_meta"]),
            "count": ", ".join(groups["count"]),
            "character": ", ".join(groups["character"]),
            "series": ", ".join(groups["series"]),
            "artist": ", ".join(groups["artist"]),
            "general": ", ".join(groups["general"]),
        }

        with _result_cache_lock:
            _result_cache[cache_key] = result
        return result
    finally:
        evt.set()
        with _building_lock:
            _building_events.pop(post_id, None)

# ── 搜索结果缓存（和画廊一样，内存缓存 1 小时） ──
_search_cache = {}
_SEARCH_CACHE_TTL = 3600

def _search_cache_key(tags, page, limit, rating):
    if isinstance(rating, list):
        rk = ",".join(sorted(r.strip().lower() for r in rating if r and r.strip()))
    else:
        rk = ",".join(sorted(r.strip().lower() for r in (rating or "").split(",") if r.strip()))
    return f"{tags}:{page}:{limit}:{rk}"

# ── API 路由 ───────────────────────────────────────

def register_routes():
    """注册所有 API 路由"""

    @PromptServer.instance.routes.post("/danbooru_anima/search")
    async def search(request):
        """搜索帖子（带内存缓存，1 小时过期）"""
        try:
            data = await request.json()
            tags = data.get("tags", "")
            page = int(data.get("page", 1))
            limit = int(data.get("limit", 12))
            rating = data.get("rating", None)
            order = data.get("order", None)

            # 查缓存
            ck = _search_cache_key(tags, page, limit, rating)
            cached = _search_cache.get(ck)
            if cached and time.time() - cached["ts"] < _SEARCH_CACHE_TTL:
                print(f"[DanbooruAnima] 搜索命中缓存: '{tags}'")
                return web.json_response(cached["data"])

            print(f"[DanbooruAnima] 搜索: tags='{tags}' page={page} limit={limit}")
            posts = search_posts(tags, page, limit, rating, order)

            # 收集所有标签→批量查分类→嵌入搜索结果（点 🔍 秒开）
            all_tags = list(set(
                t.strip() for p in posts
                for t in p.get("tag_string", "").split() if t.strip()
            ))
            cat_map = await asyncio.to_thread(get_tag_categories_batch, all_tags)

            simplified = []
            for p in posts:
                is_video = p.get("file_ext", "") in ("mp4", "webm", "gif") or "ugoira" in p.get("tag_string", "")
                tag_list = [t.strip() for t in p.get("tag_string", "").split() if t.strip()]
                groups = classify_tags(tag_list, cat_map)
                # 翻译
                _translations = {}
                for t in tag_list:
                    cn = _EN_TO_CN.get(t)
                    if cn:
                        _translations[t] = cn
                simplified.append({
                    "id": p.get("id"),
                    "preview_url": p.get("preview_file_url", "") or p.get("large_file_url", "") or "",
                    "large_url": p.get("large_file_url", "") or p.get("file_url", "") or "",
                    "file_url": p.get("file_url", "") or "",
                    "is_video": is_video,
                    "tags": p.get("tag_string", ""),
                    "rating": p.get("rating", ""),
                    "score": p.get("score", 0),
                    "width": p.get("image_width", 0),
                    "height": p.get("image_height", 0),
                    "classified": groups,
                    "translations": _translations,
                })

            # 写入缓存
            resp_data = {"success": True, "posts": simplified, "page": page}
            _search_cache[ck] = {"data": resp_data, "ts": time.time()}
            if len(_search_cache) > 200:
                for k in list(_search_cache.keys())[:30]:
                    del _search_cache[k]
            print(f"[DanbooruAnima] 搜索返回 {len(simplified)} 条结果")
            return web.json_response(resp_data)
        except Exception as e:
            import traceback
            print(f"[DanbooruAnima] 搜索失败: {e}\n{traceback.format_exc()}")
            return web.json_response({"success": False, "error": str(e)}, status=500)

    @PromptServer.instance.routes.get("/danbooru_anima/refresh_index")
    async def refresh_index(request):
        """手动刷新中文索引"""
        try:
            _CN_INDEX.clear()
            _CHAR_INDEX.clear()
            global _CN_INDEX_LOADED
            _CN_INDEX_LOADED = False
            _ensure_cn_index(force_reload=True)
            total = sum(len(v) for v in _CN_INDEX.values())
            return web.json_response({"success": True, "entries": len(_CN_INDEX), "tags": total})
        except Exception as e:
            return web.json_response({"success": False, "error": str(e)}, status=500)

    @PromptServer.instance.routes.get("/danbooru_anima/build_tag_table_progress")
    async def build_tag_table_progress(request):
        return web.json_response(_build_table_progress)

    @PromptServer.instance.routes.get("/danbooru_anima/build_tag_table")
    async def build_tag_table(request):
        """在后台线程执行，避免阻塞事件循环"""
        _build_table_progress.clear()
        _build_table_progress.update({"current": "启动中...", "total_groups": 0, "done_groups": 0, "result": None})

        def _run():
            try:
                fp = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tag_groups.json")
                with open(fp, "r", encoding="utf-8") as f:
                    existing = json.load(f)
                tag_to_groups = existing.get("tag_to_groups", {})
                # 按 tag_group 从 Danbooru API 批量拉取
                api_groups = {
                    "body_parts": "body_features", "hair": "body_features",
                    "attire": "clothing", "sexual_attire": "clothing",
                    "accessories": "accessories",
                    "backgrounds": "background", "locations": "background",
                    "posture": "pose", "gestures": "pose",
                    "facial_expression": "expression",
                    "image_composition": "other", "visual_aesthetic": "other",
                    "colors": "other", "techniques": "other",
                    "flowers": "other", "food": "other", "objects": "other",
                    "vehicles": "other", "weapons": "other", "cards": "other",
                    "plants": "other", "history": "other",
                }
                api_groups_list = list(api_groups.items())
                _build_table_progress["total_groups"] = len(api_groups_list)
                new_tags = 0
                for i, (grp, subcat) in enumerate(api_groups_list):
                    page = 1
                    while page <= 10:
                        url = f"https://danbooru.donmai.us/tags.json?search[tag_group]={grp}&limit=1000&page={page}"
                        _build_table_progress["current"] = f"拉取 {grp} 第{page}页"
                        try:
                            resp = _CDN_SESSION.get(url, timeout=15)
                            if resp.status_code != 200:
                                print(f"[DanbooruAnima] build_tag_table: {grp} page {page} → {resp.status_code}")
                                break
                            items = resp.json()
                            if not items:
                                break
                            for item in items:
                                tag = item.get("name", "")
                                if tag and subcat and tag not in tag_to_groups:
                                    tag_to_groups[tag] = [grp]
                                    new_tags += 1
                            page += 1
                            time.sleep(0.3)
                        except Exception:
                            break
                    _build_table_progress["done_groups"] = i + 1
                existing["tag_to_groups"] = tag_to_groups
                with open(fp, "w", encoding="utf-8") as f:
                    json.dump(existing, f, ensure_ascii=False, indent=2)
                _build_table_progress["result"] = {"success": True, "新增": new_tags, "总数": len(tag_to_groups)}
                _build_table_progress["current"] = "完成"
            except Exception as e:
                import traceback
                traceback.print_exc()
                _build_table_progress["result"] = {"success": False, "error": str(e)}
                _build_table_progress["current"] = f"失败: {e}"

        threading.Thread(target=_run, daemon=True).start()
        return web.json_response({"success": True, "message": "已启动"})

    @PromptServer.instance.routes.get("/danbooru_anima/post/{post_id}")
    async def post_detail(request):
        """获取帖子详情（含完整标签和 category，带缓存）"""
        try:
            post_id = request.match_info.get("post_id")
            print(f"[DanbooruAnima] 获取帖子详情: post_id={post_id}")
            post = _get_post_cached(post_id)
            if not post:
                return web.json_response({"success": False, "error": "帖子不存在"}, status=404)

            tag_string = post.get("tag_string", "")
            tags = [t.strip() for t in tag_string.split() if t.strip()]
            print(f"[DanbooruAnima] 帖子 {post_id} 有 {len(tags)} 个标签")

            # 中文翻译
            _ensure_cn_index()
            translations = {}
            for t in tags:
                if _EN_TO_CN:
                    cn = _EN_TO_CN.get(t)
                    if cn:
                        translations[t] = cn

            # 检查分类缓存（带 per-post 锁，避免重复计算）
            category_map = {}
            while True:
                with _classified_cache_lock:
                    cached_groups = _classified_cache.get(post_id)
                if cached_groups:
                    groups = cached_groups
                    break
                with _classifying_posts_lock:
                    if post_id not in _classifying_posts:
                        _classifying_posts.add(post_id)
                        break
                await asyncio.sleep(0.05)
            if not cached_groups:
                try:
                    category_map = await asyncio.to_thread(get_tag_categories_batch, tags)
                    groups = classify_tags(tags, category_map)
                    with _classified_cache_lock:
                        _classified_cache[post_id] = groups
                finally:
                    with _classifying_posts_lock:
                        _classifying_posts.discard(post_id)

            # 后台预缓存 browse() 完整结果（图片+标签）
            threading.Thread(target=_precache_browse, args=(post_id,), daemon=True).start()

            return web.json_response({
                "success": True,
                "translations": translations,
                "post": {
                    "id": post.get("id"),
                    "preview_url": post.get("preview_file_url", "") or "",
                    "large_url": post.get("large_file_url", "") or "",
                    "file_url": post.get("file_url", "") or "",
                    "tags": tags,
                    "category_map": category_map,
                    "rating": post.get("rating", ""),
                    "score": post.get("score", 0),
                },
                "classified": {
                    "quality_meta": groups["quality_meta"],
                    "count": groups["count"],
                    "character": groups["character"],
                    "series": groups["series"],
                    "artist": groups["artist"],
                    "general": groups["general"],
                    "all": groups["all"],
                }
            })
        except Exception as e:
            import traceback
            print(f"[DanbooruAnima] 获取帖子详情失败: {e}\n{traceback.format_exc()}")
            return web.json_response({"success": False, "error": str(e)}, status=500)

    @PromptServer.instance.routes.get("/danbooru_anima/translate_post/{post_id}")
    async def translate_post(request):
        """轻量翻译接口：仅本地索引（毫秒），API 补充由 JS 异步调 batch_translate"""
        try:
            post_id = request.match_info.get("post_id")
            post = _get_post_cached(post_id)
            if not post:
                return web.json_response({"success": False, "error": "no post"}, status=404)
            _ensure_cn_index()
            tags = [t.strip() for t in post.get("tag_string", "").split() if t.strip()]
            translations = {}
            for t in tags:
                cn = _EN_TO_CN.get(t)
                if cn:
                    translations[t] = cn
            return web.json_response({"success": True, "translations": translations, "total_tags": len(tags), "translated": len(translations)})
        except Exception as e:
            import traceback
            print(f"[DanbooruAnima] translate_post 异常: {e}\n{traceback.format_exc()}")
            return web.json_response({"success": False, "error": str(e)}, status=500)
    
    @PromptServer.instance.routes.get("/danbooru_anima/diag_index")
    async def diag_index(request):
        """诊断：查看本地中文索引状态"""
        _ensure_cn_index()
        return web.json_response({
            "loaded": _CN_INDEX_LOADED,
            "entries": len(_CN_INDEX),
            "chars": len(_CHAR_INDEX),
            "sample": list(_CN_INDEX.keys())[:5] if _CN_INDEX else [],
        })

    @PromptServer.instance.routes.get("/danbooru_anima/diag_cdn")
    async def diag_cdn(request):
        """CDN 诊断：自动取一张真实 post 的图片来测试"""
        from .tag_utils import search_posts as _sp
        posts = _sp("order:rank", 1, 1, [])
        if not posts:
            return web.json_response({"error": "search failed"}, status=500)
        p = posts[0]
        url = p.get("preview_file_url") or p.get("large_file_url") or p.get("file_url") or ""
        results = []
        configs = [
            {"label": "原始URL",           "url": url,                     "verify": True,  "ua": "Mozilla/5.0"},
            {"label": "verify=False",      "url": url,                     "verify": False, "ua": "Mozilla/5.0"},
            {"label": "画廊同款UA",         "url": url,                     "verify": False, "ua": "Danbooru-Gallery/1.0"},
            {"label": "media域名",         "url": url.replace("cdn.donmai.us","media.donmai.us"), "verify": False, "ua": "Mozilla/5.0"},
            {"label": "画廊同款UA+media",  "url": url.replace("cdn.donmai.us","media.donmai.us"), "verify": False, "ua": "Danbooru-Gallery/1.0"},
        ]
        for cfg in configs:
            try:
                t0 = time.time()
                r = requests.get(cfg["url"], headers={"User-Agent": cfg["ua"]}, timeout=5, verify=cfg["verify"])
                elapsed = round(time.time() - t0, 2)
                results.append({"label": cfg["label"], "status": r.status_code, "len": len(r.content), "time": elapsed})
            except Exception as e:
                results.append({"label": cfg["label"], "error": str(e)[:80]})
        return web.json_response({"url": url, "results": results})

    @PromptServer.instance.routes.get("/danbooru_anima/image_proxy")
    async def image_proxy(request):
        """CDN 图片代理：信号量限流 3 并发，无磁盘缓存（和画廊一致）"""
        file_url = request.query.get("url")
        if not file_url:
            return web.json_response({"error": "missing url"}, status=400)
        async with _get_image_proxy_semaphore():
            try:
                resp = await asyncio.to_thread(_CDN_SESSION.get, file_url, timeout=15, verify=False)
                if resp.status_code == 200:
                    return web.Response(
                        body=resp.content,
                        content_type="image/jpeg",
                        headers={"Cache-Control": "public, max-age=86400"}
                    )
            except Exception:
                pass
        return web.json_response({"error": "proxy fail"}, status=502)

    @PromptServer.instance.routes.post("/danbooru_anima/batch_images")
    async def batch_images(request):
        """批量下载图片并返回 base64，前端分批渲染"""
        try:
            data = await request.json()
            urls = data.get("urls", [])
            if not urls:
                return web.json_response({"success": True, "images": []})
            # 限制最多 6 张
            urls = urls[:6]
            # 并发下载
            async def _dl(url):
                try:
                    async with _get_image_proxy_semaphore():
                        resp = await asyncio.to_thread(_CDN_SESSION.get, url, timeout=15, verify=False)
                        if resp.status_code == 200:
                            return {"url": url, "base64": base64.b64encode(resp.content).decode()}
                except Exception:
                    pass
                return {"url": url, "base64": None}
            tasks = [_dl(u) for u in urls]
            results = await asyncio.gather(*tasks)
            return web.json_response({"success": True, "images": results})
        except Exception as e:
            return web.json_response({"success": False, "error": str(e)}, status=500)

    @PromptServer.instance.routes.post("/danbooru_anima/translate_tags")
    async def translate_tags(request):
        """批量查询标签的中文翻译"""
        try:
            data = await request.json()
            tags = data.get("tags", [])
            if not tags:
                return web.json_response({"success": True, "translations": {}})
            _ensure_cn_index()
            result = {}
            for t in tags:
                cn = _EN_TO_CN.get(t.strip().lower())
                if cn:
                    # 只取第一个中文名（逗号前的部分）
                    result[t] = cn.split(",")[0].strip()
            return web.json_response({"success": True, "translations": result})
        except Exception as e:
            return web.json_response({"success": False, "error": str(e)}, status=500)

    @PromptServer.instance.routes.post("/danbooru_anima/local_tags")
    async def local_tags(request):
        """纯本地模糊搜索（毫秒级），打字时自动触发"""
        try:
            data = await request.json()
            query = data.get("query", "").strip()
            if not query or len(query) < 2:
                return web.json_response({"success": True, "tags": []})
            tags = _search_local(query)
            tags = [t for t in tags if " " not in t["tag"]]
            return web.json_response({"success": True, "tags": tags[:15]})
        except Exception:
            return web.json_response({"success": True, "tags": []})

    @PromptServer.instance.routes.post("/danbooru_anima/fuzzy_tags")
    async def fuzzy_tags(request):
        """
        本地 + 可选云端搜索。
        cloud: true → 本地查完后再调远程语义 API 补充
        cloud: false / 缺省 → 只本地搜索（毫秒级）
        """
        try:
            data = await request.json()
            query = data.get("query", "").strip()
            cloud = data.get("cloud", False)
            if not query or len(query) < 1:
                return web.json_response({"success": True, "tags": []})

            # 内存缓存（10分钟）— 云端结果不缓存（避免云端数据过期）
            if not cloud:
                cached = _get_cached(query)
                if cached is not None:
                    return web.json_response({"success": True, "tags": cached, "from_cache": True})

            # ── 本地索引搜索 ──
            tags = _search_local(query)

            # ── 云端搜索（仅当 cloud=True 时） ──
            if cloud:
                try:
                    exist = {t["tag"] for t in tags}
                    api_queries = [query]
                    has_cjk = any('\u4e00' <= c <= '\u9fff' for c in query)
                    if has_cjk and '·' not in query:
                        api_queries.append(query + '·')
                    for aq in api_queries:
                        try:
                            ds = requests.post(
                                "https://sakizuki-danboorusearch.hf.space/api/search",
                                json={"query": aq, "limit": 12, "top_k": 5, "show_nsfw": False},
                                timeout=8
                            )
                        except Exception:
                            continue
                        if ds and ds.status_code == 200:
                            try:
                                body = ds.json()
                            except Exception:
                                continue
                            for item in (body.get("results") or body.get("tags") or body.get("data") or []):
                                tag = item.get("tag") or item.get("name") or ""
                                cn = item.get("cn_name") or item.get("translation") or item.get("chinese") or ""
                                if tag:
                                    for cn_part in cn.split(","):
                                        cn_part = cn_part.strip()
                                        if cn_part:
                                            _CN_INDEX.setdefault(cn_part, [])
                                            if tag not in _CN_INDEX[cn_part]:
                                                _CN_INDEX[cn_part].append(tag)
                                                global _EN_TO_CN
                                                if tag not in _EN_TO_CN:
                                                    _EN_TO_CN[tag] = cn_part
                                                for ch in cn_part:
                                                    if ch not in _CHAR_INDEX:
                                                        _CHAR_INDEX[ch] = set()
                                                    _CHAR_INDEX[ch].add(cn_part)
                                                _fuzzy_cache.clear()
                                                _save_persist_cn(tag, cn_part)
                                if tag and tag not in exist:
                                    tags.append({"tag": tag, "cn": cn, "src": "语义"})
                                    exist.add(tag)
                except Exception:
                    pass  # API 失败不影响本地结果
                # 云端结果按 src 排序：本地靠前，语义靠后
                tags.sort(key=lambda t: 0 if t.get("src") == "本地" else 1)

            tags = [t for t in tags if " " not in t["tag"]]
            tags = tags[:15]
            if not cloud:
                _set_cached(query, tags)
            return web.json_response({"success": True, "tags": tags})
        except Exception as e:
            # 只有本地搜索也炸了才走到这里，极少
            return web.json_response({"success": True, "tags": []})



    @PromptServer.instance.routes.post("/danbooru_anima/tag_categories")
    async def tag_categories(request):
        """批量查询 tag category"""
        try:
            data = await request.json()
            tags = data.get("tags", [])
            category_map = get_tag_categories_batch(tags)
            return web.json_response({"success": True, "categories": category_map})
        except Exception as e:
            return web.json_response({"success": False, "error": str(e)}, status=500)

    @PromptServer.instance.routes.post("/danbooru_anima/set_language")
    async def set_language(request):
        """从浏览器端接收 UI 语言并缓存，使 Python 端也能知道当前语言"""
        try:
            data = await request.json()
            lang = data.get("language", "en-US") or "en-US"
            with open(_LANG_STORE_PATH, "w", encoding="utf-8") as f:
                json.dump({"language": lang}, f)
            # 更新全局变量，让当前进程生效
            global _COMFY_LANG, _PORT_ALL, _PORT_QM, _PORT_CNT, _PORT_CHR, _PORT_SRS, _PORT_ART, _PORT_GEN, _PORT_UNCLASSIFIED
            _COMFY_LANG = lang
            _PORT_ALL = _tl("port_all")
            _PORT_QM = _tl("port_quality_meta")
            _PORT_CNT = _tl("port_count")
            _PORT_CHR = _tl("port_character")
            _PORT_SRS = _tl("port_series")
            _PORT_ART = _tl("port_artist")
            _PORT_GEN = _tl("port_general")
            _PORT_UNCLASSIFIED = _tl("port_unclassified")
            # 同步更新类属性（ComfyUI 读取的是 DanbooruBrowser.RETURN_NAMES）
            DanbooruBrowser.RETURN_NAMES = ("image", _PORT_ALL, _PORT_QM, _PORT_CNT,
                                             _PORT_CHR, _PORT_SRS, _PORT_ART, _PORT_GEN, _PORT_UNCLASSIFIED)
            print(f"[DanbooruAnima] 语言已更新: {lang}")
            return web.json_response({"success": True, "language": lang})
        except Exception as e:
            import traceback
            print(f"[DanbooruAnima] set_language 异常: {e}\n{traceback.format_exc()}")
            return web.json_response({"success": False, "error": str(e)}, status=500)

    @PromptServer.instance.routes.get("/danbooru_anima/settings")
    async def get_settings(request):
        return web.json_response({"success": True, "settings": load_settings()})

    @PromptServer.instance.routes.post("/danbooru_anima/settings")
    async def update_settings(request):
        try:
            data = await request.json()
            settings = load_settings()
            allowed_keys = ("danbooru_username", "danbooru_api_key", "blacklist_tags",)
            for key in allowed_keys:
                if key in data:
                    old_val = settings.get(key)
                    new_val = data[key]
                    if old_val != new_val and key == "original_resolution":
                        # 原图输出切换 → 清空结果缓存，下次 browse() 重新构建
                        with _result_cache_lock:
                            _result_cache.clear()
                    settings[key] = new_val
            save_settings(settings)
            return web.json_response({"success": True})
        except Exception as e:
            return web.json_response({"success": False, "error": str(e)}, status=500)

    # ── 标签收藏夹 API ─────────────────────────────────

    @PromptServer.instance.routes.get("/danbooru_anima/favorites")
    async def get_favorites(request):
        """获取全部收藏（含 _order 保持添加顺序）"""
        from favorites import load_favorites
        favs = load_favorites()
        # 为每个 category 添加 _order 数组保持插入顺序（绕过 JS Object.keys 数字键重排）
        for cat in list(favs.keys()):
            if isinstance(favs.get(cat), dict) and not cat.startswith("_"):
                keys = [k for k in favs[cat].keys() if k != "_order"]
                favs[cat]["_order"] = keys
        return web.json_response({"success": True, "favorites": favs})

    @PromptServer.instance.routes.post("/danbooru_anima/favorites/add")
    async def add_favorite(request):
        """添加收藏 {tag, category, thumb_url, cn}"""
        try:
            from favorites import load_favorites, save_favorites
            data = await request.json()
            tag = data.get("tag", "").strip()
            category = data.get("category", "general")  # artists/characters/series/general
            thumb_url = data.get("thumb_url", "")
            cn = data.get("cn", "")
            if not tag:
                return web.json_response({"success": False, "error": "tag required"})
            favs = load_favorites()
            if category not in favs:
                favs[category] = {}
            favs[category][tag] = {"thumb": thumb_url, "cn": cn}
            save_favorites(favs)
            return web.json_response({"success": True})
        except Exception as e:
            return web.json_response({"success": False, "error": str(e)}, status=500)

    @PromptServer.instance.routes.post("/danbooru_anima/favorites/remove")
    async def remove_favorite(request):
        """删除收藏 {tag, category}"""
        try:
            from favorites import load_favorites, save_favorites
            data = await request.json()
            tag = data.get("tag", "").strip()
            category = data.get("category", "general")
            if not tag:
                return web.json_response({"success": False, "error": "tag required"})
            favs = load_favorites()
            if category in favs and tag in favs[category]:
                del favs[category][tag]
                # 同时从文件夹中移除引用
                if "_folders" in favs and category in favs["_folders"]:
                    for fname in list(favs["_folders"][category].keys()):
                        folder_items = favs["_folders"][category][fname]
                        if tag in folder_items:
                            folder_items.remove(tag)
                save_favorites(favs)
            return web.json_response({"success": True})
        except Exception as e:
            return web.json_response({"success": False, "error": str(e)}, status=500)

    @PromptServer.instance.routes.post("/danbooru_anima/favorites/folder")
    async def favorites_folder(request):
        """文件夹操作 {action, category, name, new_name, item_keys, target_folder}"""
        try:
            from favorites import load_favorites, save_favorites, folder_create, folder_rename, folder_delete, folder_move
            data = await request.json()
            action = data.get("action")
            category = data.get("category", "")
            if not action or not category:
                return web.json_response({"success": False, "error": "action and category required"})
            if category not in ("artists", "characters", "series", "general", "images"):
                return web.json_response({"success": False, "error": "invalid category"})
            favs = load_favorites()
            if action == "create":
                ok, err = folder_create(favs, category, data.get("name", ""))
                if not ok: return web.json_response({"success": False, "error": err})
            elif action == "rename":
                ok, err = folder_rename(favs, category, data.get("name", ""), data.get("new_name", ""))
                if not ok: return web.json_response({"success": False, "error": err})
            elif action == "delete":
                ok, err = folder_delete(favs, category, data.get("name", ""))
                if not ok: return web.json_response({"success": False, "error": err})
            elif action == "move":
                ok, err = folder_move(favs, category, data.get("item_keys", []), data.get("target_folder", ""))
                if not ok: return web.json_response({"success": False, "error": err})
            elif action == "remove_from_all":
                from favorites import folder_remove_from_all
                ok, err = folder_remove_from_all(favs, category, data.get("item_keys", []))
                if not ok: return web.json_response({"success": False, "error": err})
            else:
                return web.json_response({"success": False, "error": f"unknown action: {action}"})
            save_favorites(favs)
            return web.json_response({"success": True})
        except Exception as e:
            return web.json_response({"success": False, "error": str(e)}, status=500)

    @PromptServer.instance.routes.get("/danbooru_anima/favorites/export")
    async def export_favorites(request):
        """导出全部收藏为 JSON 文件（直接下载）"""
        try:
            from favorites import load_favorites
            favs = load_favorites()
            body = json.dumps(favs, ensure_ascii=False, indent=2)
            return web.Response(
                body=body,
                content_type="application/json",
                headers={
                    "Content-Disposition": f'attachment; filename="danbooru_favorites_{time.strftime("%Y-%m-%d")}.json"',
                    "Cache-Control": "no-cache",
                }
            )
        except Exception as e:
            return web.json_response({"success": False, "error": str(e)}, status=500)

    @PromptServer.instance.routes.post("/danbooru_anima/favorites/import")
    async def import_favorites(request):
        """导入收藏：mode=merge（不覆盖）或 overwrite（覆盖）"""
        try:
            from favorites import load_favorites, save_favorites
            data = await request.json()
            imported = data.get("favorites", {})
            mode = data.get("mode", "merge")
            if not isinstance(imported, dict):
                return web.json_response({"success": False, "error": "格式错误，需要 favorites 对象"})
            favs = load_favorites()

            import_folders = imported.pop("_folders", {})

            if mode == "overwrite":
                # ── 覆盖模式 ──
                # 1. 记下当前所有图片 ID
                all_current_ids = set()
                for cat, items in favs.items():
                    if isinstance(items, dict) and not cat.startswith("_"):
                        all_current_ids.update(items.keys())
                # 2. 清空文件夹结构
                favs["_folders"] = {}
                # 3. 导入数据覆盖/添加
                for cat, tags in imported.items():
                    if not isinstance(tags, dict) or cat.startswith("_"):
                        continue
                    favs[cat] = dict(tags)  # 完全替换
                # 4. 应用导入的文件夹
                for cat, folders in import_folders.items():
                    if not isinstance(folders, dict):
                        continue
                    if cat not in favs["_folders"]:
                        favs["_folders"][cat] = {}
                    for fname, items in folders.items():
                        if not isinstance(items, list):
                            continue
                        favs["_folders"][cat][fname] = list(items)
                # 5. 不在导入数据中的原图片归入未分类
                import_ids = set()
                for cat, items in imported.items():
                    if isinstance(items, dict) and not cat.startswith("_"):
                        import_ids.update(items.keys())
                orphaned = all_current_ids - import_ids
                # 确保这些图片数据还在 favs 中，但不在任何文件夹里
                for oid in orphaned:
                    for cat in list(favs.keys()):
                        if isinstance(favs[cat], dict) and not cat.startswith("_") and oid in favs[cat]:
                            break
                _imported_cnt = sum(len(v) for k, v in imported.items() if isinstance(v, dict) and not k.startswith("_"))
                msg = f"覆盖导入完成：已导入 {_imported_cnt} 条，{len(orphaned)} 条原收藏移到未分类"

            else:
                # ── 合并模式（不覆盖） ──
                if "_folders" not in favs:
                    favs["_folders"] = {}
                cat_count = 0
                new_items = set()
                for cat, tags in imported.items():
                    if not isinstance(tags, dict) or cat.startswith("_"):
                        continue
                    if cat not in favs:
                        favs[cat] = {}
                    for k, v in tags.items():
                        if k not in favs[cat]:
                            favs[cat][k] = v
                            new_items.add(k)
                            cat_count += 1
                # 只添加新图片到文件夹
                for cat, folders in import_folders.items():
                    if not isinstance(folders, dict):
                        continue
                    if cat not in favs["_folders"]:
                        favs["_folders"][cat] = {}
                    for fname, items in folders.items():
                        if not isinstance(items, list):
                            continue
                        if fname not in favs["_folders"][cat]:
                            favs["_folders"][cat][fname] = []
                        for k in items:
                            if k in new_items and k not in favs["_folders"][cat][fname]:
                                favs["_folders"][cat][fname].append(k)
                msg = f"合并完成：新增 {cat_count} 条（已有图片已跳过）"

            # 清理孤儿的文件夹引用（不创建占位符）
            for cat, folders in favs.get("_folders", {}).items():
                if cat not in favs:
                    favs[cat] = {}
                for _fname in list(folders.keys()):
                    folders[_fname] = [k for k in folders[_fname] if k in favs[cat]]
                    if not folders[_fname]:
                        del folders[_fname]
            save_favorites(favs)
            return web.json_response({"success": True, "message": msg})
        except Exception as e:
            import traceback
            return web.json_response({"success": False, "error": str(e), "trace": traceback.format_exc()}, status=500)

    @PromptServer.instance.routes.post("/danbooru_anima/favorites/update_thumb")
    async def update_thumb(request):
        """更新缩略图 {tag, category, thumb_url}"""
        try:
            from favorites import load_favorites, save_favorites
            data = await request.json()
            tag = data.get("tag", "").strip()
            category = data.get("category", "general")
            thumb_url = data.get("thumb_url", "")
            if not tag:
                return web.json_response({"success": False, "error": "tag required"})
            favs = load_favorites()
            if category in favs and tag in favs[category]:
                favs[category][tag]["thumb"] = thumb_url
                save_favorites(favs)
            return web.json_response({"success": True})
        except Exception as e:
            return web.json_response({"success": False, "error": str(e)}, status=500)


    @PromptServer.instance.routes.post("/danbooru_anima/update_csv")
    async def update_csv(request):
        """从 DanbooruSearchOnline 更新 tags_enhanced.csv 并重建缓存"""
        import subprocess, shutil, os
        try:
            plugin_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            csv_path = os.path.join(plugin_dir, "tags_enhanced.csv")
            csv_url = "https://raw.githubusercontent.com/SuzumiyaAkizuki/DanbooruSearchOnline/main/origin_database/tags_enhanced.csv"

            # 下载新 CSV
            print(f"[DanbooruAnima] 下载最新标签数据库...")
            resp = requests.get(csv_url, timeout=30)
            if resp.status_code != 200:
                return web.json_response({"success": False, "error": f"下载失败: HTTP {resp.status_code}"})

            with open(csv_path, "wb") as f:
                f.write(resp.content)
            print(f"[DanbooruAnima] 标签数据库已更新 ({len(resp.content)/1024/1024:.1f} MB)")

            # 删除旧缓存，触发重建
            cache_dir = os.path.join(os.path.dirname(__file__), "tags_embedding")
            if os.path.isdir(cache_dir):
                shutil.rmtree(cache_dir)
                print(f"[DanbooruAnima] 旧缓存已删除")

            # 重置语义引擎的错误状态，下次请求自动重建
            try:
                from .tag_engine import DanbooruTagger
                DanbooruTagger._instance = None
            except:
                pass

            return web.json_response({"success": True, "message": "标签数据库已更新，缓存已清除，下次搜索将自动重建"})
        except Exception as e:
            import traceback
            print(f"[DanbooruAnima] 更新失败: {e}\n{traceback.format_exc()}")
            return web.json_response({"success": False, "error": str(e)}, status=500)


# 分类表构建进度（模块级，路由和后台线程共享）
_build_table_progress = {"current": "", "total_groups": 0, "done_groups": 0, "result": None}

# 启动所有 API 路由
register_routes()

# 注册语义搜索 API 路由（vec_search）
try:
    from .vec_search import register_routes as register_vec_routes
    register_vec_routes()
    print("[DanbooruAnima] 语义搜索路由已注册")
except ImportError:
    print("[DanbooruAnima] vec_search 未加载（可能缺少依赖）")
except Exception as e:
    print(f"[DanbooruAnima] vec_search 路由注册失败: {e}")

# ── 节点定义 ───────────────────────────────────────

# ── 语言检测 ────────────────────────────────────────
from folder_paths import get_user_directory
_LANG_STORE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_lang_cache.json")
def _detect_language():
    """读取 ComfyUI 设置或之前 JS 上报的语言"""
    # 优先读取 JS 上报的语言缓存（持久化跨重启）
    if os.path.isfile(_LANG_STORE_PATH):
        try:
            with open(_LANG_STORE_PATH, "r", encoding="utf-8") as f:
                cached = json.load(f)
            lang = cached.get("language", "")
            if lang:
                return lang
        except Exception:
            pass
    # 回退：读取 comfyui.settings.json
    try:
        settings_path = os.path.join(get_user_directory(), "comfyui.settings.json")
        if os.path.isfile(settings_path):
            with open(settings_path, "r", encoding="utf-8") as f:
                settings = json.load(f)
            lang = settings.get("language", "") or ""
            if lang:
                return lang
    except Exception:
        pass
    return "en-US"

_COMFY_LANG = _detect_language()
print(f"[DanbooruAnima] 检测到 UI 语言: {_COMFY_LANG}")

# ── 标签类别翻译 ─────────────────────────────────────
_TRANSLATIONS = {}
_tl_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "translations.json")
if os.path.isfile(_tl_path):
    try:
        with open(_tl_path, "r", encoding="utf-8") as f:
            _TRANSLATIONS = json.load(f)
        print(f"[DanbooruAnima] 翻译字典已加载: {list(_TRANSLATIONS.keys())}")
    except Exception as e:
        print(f"[DanbooruAnima] 翻译字典加载失败: {e}")
else:
    print(f"[DanbooruAnima] 翻译文件不存在: {_tl_path}")

def _tl(key):
    """获取当前语言的翻译文本，fallback 到 en-US"""
    lang = _COMFY_LANG if _COMFY_LANG in _TRANSLATIONS else "en-US"
    return _TRANSLATIONS.get(lang, {}).get(key, _TRANSLATIONS.get("en-US", {}).get(key, key))

# 根据语言设置端口名
_PORT_ALL = _tl("port_all")
_PORT_QM = _tl("port_quality_meta")
_PORT_CNT = _tl("port_count")
_PORT_CHR = _tl("port_character")
_PORT_SRS = _tl("port_series")
_PORT_ART = _tl("port_artist")
_PORT_GEN = _tl("port_general")
_PORT_UNCLASSIFIED = _tl("port_unclassified")

# 融合模式子分类需要的函数
from .tag_classifier import classify_general

def _get_blacklist_set():
    """从设置中读取黑名单标签，返回 set"""
    try:
        raw = load_settings().get("blacklist_tags", "") or ""
        if not raw:
            return set()
        return set(t.strip().lower() for t in raw.replace(",", " ").split() if t.strip())
    except Exception:
        return set()

class DanbooruBrowser:
    """
    Danbooru Browser
    内嵌浏览器，搜索/浏览 Danbooru 图片，选中后输出按 Anima 分类的 tags
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "selection_data": ("STRING", {"default": "{}", "multiline": True}),
                "rating_filter": ("STRING", {"default": "{}", "multiline": True}),
                "node_settings": ("STRING", {"default": "{}", "multiline": True}),
            },
            "optional": {
                "来自AnimaDex": ("STRING", {"default": ""}),
                "_tag_fusion": ("STRING", {"default": "{}", "multiline": True}),
            },
        }

    RETURN_TYPES = ("IMAGE", "STRING", "STRING", "STRING", "STRING", "STRING", "STRING", "STRING", "STRING")
    RETURN_NAMES = ("image", _PORT_ALL, _PORT_QM, _PORT_CNT,
                    _PORT_CHR, _PORT_SRS, _PORT_ART, _PORT_GEN, _PORT_UNCLASSIFIED)
    OUTPUT_IS_LIST = (True, False, False, False, False, False, False, False, False)
    FUNCTION = "browse"
    CATEGORY = "Danbooru Anima"

    @classmethod
    def IS_CHANGED(cls, selection_data="{}", exclude_tags="", **kwargs):
        return float("NaN")

    @staticmethod
    def _filter_groups(groups, blacklist_set):
        """从所有分类组中移除黑名单标签"""
        if not blacklist_set:
            return groups
        return {k: [t for t in v if t.lower() not in blacklist_set] for k, v in groups.items()}

    def _get_post_tags(self, post_id, blacklist_set, original_resolution=True, skip_image=False):
        """获取单张 post 的图片 tensor + 分类标签组"""
        ck = (post_id, original_resolution)

        # 先查结果缓存：如果之前跑过（无论是否跳过图片），直接复用 tags
        with _result_cache_lock:
            cached = _result_cache.get(ck)
        if cached:
            img = self._placeholder_image() if skip_image else (
                cached["image"] if cached["image"] is not None else self._placeholder_image())
            groups = self._filter_groups({
                "all": cached["all"].split(", ") if cached["all"] else [],
                "quality_meta": cached["quality_meta"].split(", ") if cached["quality_meta"] else [],
                "count": cached["count"].split(", ") if cached["count"] else [],
                "character": cached["character"].split(", ") if cached["character"] else [],
                "series": cached["series"].split(", ") if cached["series"] else [],
                "artist": cached["artist"].split(", ") if cached["artist"] else [],
                "general": cached["general"].split(", ") if cached["general"] else [],
            }, blacklist_set)
            return img, groups

        # 缓存未命中 → 需要取 post 元数据
        post = _get_post_cached(post_id)
        if not post:
            return None
        tag_string = post.get("tag_string", "")
        tags = [t.strip() for t in tag_string.split() if t.strip()]
        category_map = get_tag_categories_batch(tags)
        groups = self._filter_groups(classify_tags(tags, category_map), blacklist_set)

        if skip_image:
            return self._placeholder_image(), groups

        # 需要图片 → 触发下载
        cached = _precache_browse(post_id, original_resolution=original_resolution)
        if cached:
            img = cached["image"] if cached["image"] is not None else self._placeholder_image()
        else:
            img = self._placeholder_image()
        return img, groups
        cached = _precache_browse(post_id, original_resolution=original_resolution)
        if cached:
            img = cached["image"] if cached["image"] is not None else self._placeholder_image()
            groups = self._filter_groups({
                "all": cached["all"].split(", ") if cached["all"] else [],
                "quality_meta": cached["quality_meta"].split(", ") if cached["quality_meta"] else [],
                "count": cached["count"].split(", ") if cached["count"] else [],
                "character": cached["character"].split(", ") if cached["character"] else [],
                "series": cached["series"].split(", ") if cached["series"] else [],
                "artist": cached["artist"].split(", ") if cached["artist"] else [],
                "general": cached["general"].split(", ") if cached["general"] else [],
            }, blacklist_set)
            return img, groups
        post = _get_post_cached(post_id)
        if not post:
            return self._placeholder_image(), None
        thumb_url = post.get("preview_file_url") or post.get("large_file_url") or ""
        thumb_img = None
        if thumb_url:
            cp = _cdn_cache_path(thumb_url)
            if os.path.isfile(cp):
                with open(cp, "rb") as f:
                    thumb_img = Image.open(f).convert("RGB")
                    thumb_img = torch.from_numpy(np.array(thumb_img).astype(np.float32) / 255.0)[None,]
            else:
                try:
                    resp = _CDN_SESSION.get(thumb_url, timeout=5, verify=False)
                    if resp.status_code == 200:
                        with open(cp, "wb") as f:
                            f.write(resp.content)
                        thumb_img = Image.open(BytesIO(resp.content)).convert("RGB")
                        thumb_img = torch.from_numpy(np.array(thumb_img).astype(np.float32) / 255.0)[None,]
                except Exception:
                    pass
        tag_string = post.get("tag_string", "")
        tags = [t.strip() for t in tag_string.split() if t.strip()]
        category_map = get_tag_categories_batch(tags)
        groups = self._filter_groups(classify_tags(tags, category_map), blacklist_set)
        img = thumb_img if thumb_img is not None else self._placeholder_image()
        return img, groups

    def browse(self, selection_data="{}", exclude_tags="", node_settings="{}", **kwargs):
        """浏览器的核心方法——支持单选(post_id)、多选(selections)、分序号融合(_tag_fusion)"""
        print(f"[DanbooruAnima] browse() 执行, selection_data='{selection_data[:120]}'")
        blacklist_set = _get_blacklist_set()

        try:
            data = json.loads(selection_data) if selection_data else {}
        except json.JSONDecodeError:
            return (self._placeholder_image(), "", "", "", "", "", "", "", "")

        # IMAGE 端口没接线 → 跳过图片下载，仅输出 tag
        _skip_img = not data.get("image_connected", True)

        # 从 node_settings 解析 original_resolution
        try:
            ns = json.loads(node_settings) if node_settings else {}
        except json.JSONDecodeError:
            ns = {}
        _or = ns.get("original_resolution", True)

        # ── 分序号融合模式 ──
        fusion_raw = (kwargs or {}).get("_tag_fusion", "") or ""
        fusion_data = {}
        if fusion_raw.strip():
            try:
                fusion_data = json.loads(fusion_raw)
            except json.JSONDecodeError:
                pass
        if fusion_data and isinstance(fusion_data, dict):
            # 每个 slot → 后置 ID 列表
            # 1号 = quality_meta + count + general(除 body_feature/accessories/clothes)
            # 2号 = character + series + body_feature + clothing + accessories
            # 3号 = artist
            result_groups = {k: [] for k in ("all", "quality_meta", "count", "character",
                                             "series", "artist", "general")}
            # 保存子分类的 general tag，最后按指定顺序合并
            _sub_buckets = {k: [] for k in ("body_features", "clothing", "pose",
                                            "expression", "background", "accessories", "other")}
            _uncategorized = []

            # 图片：优先 1 号 → 2 号 → 3 号
            img_out = None
            for fallback_key in ("1", "2", "3"):
                pids = fusion_data.get(fallback_key, [])
                if pids:
                    for pid in pids:
                        img, _ = self._get_post_tags(pid, blacklist_set, original_resolution=_or, skip_image=_skip_img)
                        if img is not None:
                            img_out = [img]
                            break
                    if img_out is not None:
                        break
            if img_out is None:
                img_out = [self._placeholder_image()]
            # ── 标签收集 ──
            for slot_key in ("1", "2", "3"):
                pids = fusion_data.get(slot_key, [])
                if not pids:
                    continue
                for pid in pids:
                    img, groups = self._get_post_tags(pid, blacklist_set, original_resolution=_or, skip_image=_skip_img)
                    if groups is None:
                        continue
                    general_tags = groups.get("general", [])
                    if slot_key == "1":
                        # 1号：quality_meta + count + general 的子集（pose/expression/background/other）
                        result_groups["quality_meta"].extend(groups.get("quality_meta", []))
                        result_groups["count"].extend(groups.get("count", []))
                        sub, uncat = classify_general(general_tags)
                        for bk in ("pose", "expression", "background", "other"):
                            _sub_buckets[bk].extend(sub.get(bk, []))
                        _uncategorized.extend(uncat)
                    elif slot_key == "2":
                        # 2号：character + series + body_features + clothing + accessories
                        result_groups["character"].extend(groups.get("character", []))
                        result_groups["series"].extend(groups.get("series", []))
                        sub, uncat = classify_general(general_tags)
                        for bk in ("body_features", "clothing", "accessories"):
                            _sub_buckets[bk].extend(sub.get(bk, []))
                        _uncategorized.extend(uncat)
                    else:  # 3号
                        result_groups["artist"].extend(groups.get("artist", []))
                    result_groups["all"].extend(groups.get("all", []))
            # ── 通用端口输出：按顺序合并子分类 ──
            _order = ["body_features", "clothing", "pose", "expression", "background", "accessories", "other"]
            _general_out = []
            for bk in _order:
                _general_out.extend(_sub_buckets[bk])
            result_groups["general"] = _general_out
            # ── 合并、去重 ──
            out = {}
            for k in result_groups:
                out[k] = ", ".join(dict.fromkeys(result_groups[k]))
            out["unclassified"] = ", ".join(dict.fromkeys(_uncategorized))
            print(f"[DanbooruAnima] 分序号融合输出: 1->{len(fusion_data.get('1',[]))}张 2->{len(fusion_data.get('2',[]))}张 3->{len(fusion_data.get('3',[]))}张")
            return (img_out, out["all"], out["quality_meta"], out["count"],
                    out["character"], out["series"], out["artist"], out["general"], out["unclassified"])

        # ── 多选分支 ──
        selections = data.get("selections") if isinstance(data, dict) else None
        if selections and len(selections) > 0:
            merge_cfg = data.get("merge", {})
            all_imgs = []
            # 按图片分组收集 tag：all_groups[k] = [ [img1_tags], [img2_tags], ... ]
            all_groups = {k: [] for k in ("quality_meta", "count", "character",
                                          "series", "artist", "general", "all")}
            for sel in selections:
                pid = sel.get("post_id")
                if not pid:
                    continue
                img, groups = self._get_post_tags(pid, blacklist_set, original_resolution=_or, skip_image=_skip_img)
                if groups is None:
                    continue
                all_imgs.append(img)
                for k in all_groups:
                    all_groups[k].append(groups.get(k, []))
            if not all_imgs:
                return (self._placeholder_image(), "", "", "", "", "", "", "", "")
            out = {}
            for k in ("all", "quality_meta", "count", "character", "series", "artist", "general"):
                img_tag_lists = all_groups[k]  # list of lists
                if merge_cfg.get(k, False):
                    # 合并去重：所有图的 tag 展平后去重
                    merged = sorted(set(t for img_tags in img_tag_lists for t in img_tags))
                    out[k] = ", ".join(merged)
                else:
                    # 不合并：每张图各自保留，用 "=== 图N ===" 显眼分隔
                    parts = []
                    for i, tags in enumerate(img_tag_lists):
                        tag_str = ", ".join(tags)
                        if i == 0:
                            parts.append(tag_str)
                        else:
                            parts.append(f"=== 图{i+1} ===\n{tag_str}")
                    out[k] = "\n".join(parts)
            # 日志：对比合并前后的 tag 总数
            flat_counts = {k: sum(len(t) for t in all_groups[k]) for k in all_groups}
            dedup_counts = {k: len(set(t for img in all_groups[k] for t in img)) for k in all_groups}
            print(f"[DanbooruAnima] 多选 merge_cfg={merge_cfg} (artist {flat_counts['artist']}→{dedup_counts['artist']})")
            return (all_imgs, out["all"], out["quality_meta"], out["count"],
                    out["character"], out["series"], out["artist"], out["general"], "")

        # ── 单选（原有逻辑） ──
        post_id = data.get("post_id") if isinstance(data, dict) else None
        if not post_id:
            return ([self._placeholder_image()], "", "", "", "", "", "", "", "")
        img, groups = self._get_post_tags(post_id, blacklist_set, original_resolution=_or, skip_image=_skip_img)
        if groups is None:
            return ([self._placeholder_image()], "", "", "", "", "", "", "", "")
        return ([img],
                ", ".join(groups["all"]), ", ".join(groups["quality_meta"]),
                ", ".join(groups["count"]), ", ".join(groups["character"]),
                ", ".join(groups["series"]), ", ".join(groups["artist"]), ", ".join(groups["general"]), "")

    def _fetch_image(self, post):
        """尝试从 CDN 下载图片（优先 sample → 预览缩略图 → 原图）"""
        cdn = post.get("large_file_url") or post.get("preview_file_url") or post.get("file_url") or ""
        if cdn:
            try:
                print(f"[DanbooruAnima] 下载图片: {cdn[:60]}...")
                resp = _CDN_SESSION.get(cdn, timeout=5, verify=False)
                if resp.status_code == 200:
                    img = Image.open(BytesIO(resp.content)).convert("RGB")
                    return torch.from_numpy(np.array(img).astype(np.float32) / 255.0)[None,]
            except Exception:
                pass  # 快速失败

        print("[DanbooruAnima] 下载失败，使用占位图")
        return self._placeholder_image()

    def _placeholder_image(self):
        """返回 1x1 灰色占位图，避免下游节点崩溃"""
        img = Image.new("RGB", (1, 1), (128, 128, 128))
        img_np = np.array(img).astype(np.float32) / 255.0
        return torch.from_numpy(img_np)[None,]


NODE_CLASS_MAPPINGS = {
    "DanbooruBrowser": DanbooruBrowser,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "DanbooruBrowser": "D站浏览器 (Danbooru Browser)",
}
