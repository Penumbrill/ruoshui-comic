"""
本地标签数据库 - 离线查 Danbooru 标签分类

从 tags_enhanced.csv 加载标签分类映射，减少 API 请求。
CSV 格式: name, cn_name, wiki, post_count, category, nsfw
category: 0=general, 1=artist, 3=series, 4=character, 5=meta

来源: https://github.com/SuzumiyaAkizuki/DanbooruSearchOnline
"""
import os
import csv
import threading

PLUGIN_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_DB_PATH = os.path.join(PLUGIN_DIR, "tags_enhanced.csv")
CSV_DOWNLOAD_URL = (
    "https://raw.githubusercontent.com/"
    "SuzumiyaAkizuki/DanbooruSearchOnline/main/"
    "origin_database/tags_enhanced.csv"
)

# ── 全局缓存 ───────────────────────────────────────
_db = None          # dict[str, int] — tag_name → category_id
_db_path = None     # 实际加载的文件路径
_db_lock = threading.Lock()
_db_loaded = False  # 是否尝试过加载（避免重复失败）


def _parse_category(val: str) -> int:
    """将 CSV 中的 category 字段转为 int"""
    try:
        return int(val.strip())
    except (ValueError, AttributeError):
        return 0


def load_db(path: str = None) -> dict[str, int] | None:
    """
    加载 CSV 文件，返回 {tag_name: category_id} 字典。
    
    Args:
        path: CSV 文件路径，默认在插件根目录查找 tags_enhanced.csv
        
    Returns:
        加载成功返回 dict，文件不存在或格式错误返回 None
    """
    global _db, _db_path, _db_loaded

    if path is None:
        path = DEFAULT_DB_PATH

    with _db_lock:
        # 如果已经加载过同一个文件，直接返回缓存
        if _db_loaded and _db_path == path:
            return _db

        if not os.path.exists(path):
            print(f"[DanbooruAnima] 本地标签数据库不存在: {path}")
            _db = None
            _db_loaded = True
            _db_path = path
            return None

        # 自动检测编码
        _encoding = None
        for enc in ["utf-8", "utf-8-sig", "gbk", "gb2312", "latin-1", "cp1252"]:
            try:
                with open(path, "r", encoding=enc) as f:
                    f.read(1024)
                _encoding = enc
                break
            except (UnicodeDecodeError, UnicodeError):
                continue
        if _encoding is None:
            print(f"[DanbooruAnima] 无法解码本地标签数据库")
            _db_loaded = True
            return None

        try:
            db = {}
            row_count = 0
            with open(path, "r", encoding=_encoding) as f:
                reader = csv.DictReader(f)
                for row in reader:
                    name = row.get("name", "").strip()
                    if not name:
                        continue
                    category = _parse_category(row.get("category", "0"))
                    db[name] = category
                    row_count += 1

            _db = db
            _db_path = path
            _db_loaded = True
            print(f"[DanbooruAnima] 本地标签数据库加载完成: {row_count} 条")
            return db

        except Exception as e:
            print(f"[DanbooruAnima] 加载本地标签数据库失败: {e}")
            _db = None
            _db_loaded = True
            _db_path = path
            return None


def lookup(tag_name: str, db: dict[str, int] = None) -> int | None:
    """
    查询单个标签的 category_id。
    
    Args:
        tag_name: 标签名（小写）
        db: 可选，传入已加载的数据库，为 None 时自动加载
        
    Returns:
        category_id (0~5) 或 None（未找到）
    """
    if db is None:
        db = _db if _db is not None else load_db()
    if db is None:
        return None
    name = tag_name.strip().lower()
    return db.get(name)


def batch_lookup(
    tag_names: list[str],
    db: dict[str, int] = None,
) -> dict[str, int]:
    """
    批量查询标签分类，只返回在本地数据库中命中的结果。
    
    Args:
        tag_names: 标签名列表
        db: 可选，自动加载
        
    Returns:
        {tag_name: category_id, ...} — 只包含命中本地库的标签
    """
    if db is None:
        db = _db if _db is not None else load_db()
    if db is None:
        return {}

    result = {}
    for tag in tag_names:
        name = tag.strip().lower()
        cat = db.get(name)
        if cat is not None:
            result[tag] = cat  # 保留原始大小写
    return result


def db_status() -> dict:
    """返回数据库状态信息"""
    db = _db if _db is not None else load_db()
    if db is None:
        return {"loaded": False, "count": 0, "path": _db_path or DEFAULT_DB_PATH}
    return {
        "loaded": True,
        "count": len(db),
        "path": _db_path or DEFAULT_DB_PATH,
    }


def download_db(path: str = None, progress_callback=None) -> bool:
    """
    从 GitHub 下载 tags_enhanced.csv。
    
    Args:
        path: 保存路径，默认插件根目录
        progress_callback: 可选的回调函数(bytes_downloaded, total_bytes)
        
    Returns:
        下载成功返回 True
    """
    import requests

    if path is None:
        path = DEFAULT_DB_PATH

    try:
        print(f"[DanbooruAnima] 正在下载本地标签数据库 (来自 DanbooruSearchOnline)...")
        resp = requests.get(CSV_DOWNLOAD_URL, stream=True, timeout=60)
        resp.raise_for_status()

        total = int(resp.headers.get("content-length", 0))
        downloaded = 0

        with open(path, "wb") as f:
            for chunk in resp.iter_content(chunk_size=8192):
                f.write(chunk)
                downloaded += len(chunk)
                if progress_callback:
                    progress_callback(downloaded, total)

        print(f"[DanbooruAnima] 下载完成: {path} ({downloaded} bytes)")
        # 下载后清除缓存，下次 load_db 重新加载
        global _db, _db_loaded
        with _db_lock:
            _db = None
            _db_loaded = False
        return True

    except Exception as e:
        print(f"[DanbooruAnima] 下载失败: {e}")
        return False
