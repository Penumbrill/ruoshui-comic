"""
标签收藏夹管理 — favorites.json 的读写
"""
import json
import os

PLUGIN_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FAVORITES_FILE = os.path.join(PLUGIN_DIR, "favorites.json")

DEFAULT_FAVORITES = {
    "artists": {},
    "characters": {},
    "series": {},
    "general": {},
    "images": {},
}


def load_favorites():
    """读取收藏数据，返回 dict"""
    try:
        if not os.path.exists(FAVORITES_FILE):
            return dict(DEFAULT_FAVORITES)
        with open(FAVORITES_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        # 确保所有分类键存在
        for key in DEFAULT_FAVORITES:
            if key not in data:
                data[key] = {}
        return data
    except Exception:
        return dict(DEFAULT_FAVORITES)


def save_favorites(data):
    """写入收藏数据"""
    try:
        with open(FAVORITES_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        return True
    except Exception:
        return False


# ── 文件夹管理 ──────────────────────────────

def _ensure_folders(data, category):
    """确保分类下有 _folders 结构"""
    if "_folders" not in data:
        data["_folders"] = {}
    if category not in data["_folders"]:
        data["_folders"][category] = {}
    if "__tmp" not in data["_folders"][category]:
        data["_folders"][category]["__tmp"] = []


def folder_create(data, category, name):
    """创建空文件夹"""
    _ensure_folders(data, category)
    if name in data["_folders"][category]:
        return False, f"文件夹「{name}」已存在"
    data["_folders"][category][name] = []
    return True, None


def folder_rename(data, category, old_name, new_name):
    """重命名文件夹"""
    _ensure_folders(data, category)
    if old_name not in data["_folders"][category]:
        return False, f"文件夹「{old_name}」不存在"
    if new_name in data["_folders"][category]:
        return False, f"文件夹「{new_name}」已存在"
    data["_folders"][category][new_name] = data["_folders"][category].pop(old_name)
    return True, None


def folder_delete(data, category, name):
    """删除文件夹，内容移入 __tmp"""
    _ensure_folders(data, category)
    if name not in data["_folders"][category]:
        return False, f"文件夹「{name}」不存在"
    if name == "__tmp":
        return False, "不能删除临时文件夹"
    items = data["_folders"][category].pop(name)
    data["_folders"][category]["__tmp"].extend(items)
    return True, None


def folder_remove_from_all(data, category, item_keys):
    """从所有文件夹（含 __tmp）中移除 key，回到未分类状态"""
    _ensure_folders(data, category)
    for fname, items in data["_folders"][category].items():
        data["_folders"][category][fname] = [k for k in items if k not in item_keys]
    return True, None


def folder_move(data, category, item_keys, target_folder):
    """将多个 key 移入目标文件夹（从所有文件夹中移除后加入）"""
    _ensure_folders(data, category)
    if target_folder not in data["_folders"][category]:
        return False, f"目标文件夹「{target_folder}」不存在"
    # 从所有文件夹（含 __tmp）中移除这些 key
    for fname, items in data["_folders"][category].items():
        data["_folders"][category][fname] = [k for k in items if k not in item_keys]
    # 加入目标文件夹
    data["_folders"][category][target_folder].extend(item_keys)
    return True, None


def folder_items(data, category, folder_name):
    """获取文件夹内的 key 列表；folder_name 为 None 时返回未分类的"""
    _ensure_folders(data, category)
    if folder_name is None:
        # 未分类：所有在 category 字典但不在任何文件夹（含 __tmp）里的 key
        all_in_folders = set()
        for items in data["_folders"][category].values():
            all_in_folders.update(items)
        return [k for k in data.get(category, {}) if k not in all_in_folders]
    return data["_folders"][category].get(folder_name, [])
