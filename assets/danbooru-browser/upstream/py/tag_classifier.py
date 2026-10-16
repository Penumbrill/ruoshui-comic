"""
节点②：Tag Classifier
接收原始标签字符串，按 category 分类输出到子类端口
支持用户手动映射（user_tag_mappings.json 覆盖官方分类）
"""
import re
import json
import os
from .tag_utils import get_tag_categories_batch, classify_tags


def _my_dir():
    return os.path.dirname(os.path.abspath(__file__))


def _load_tag_groups():
    fp = os.path.join(_my_dir(), "tag_groups.json")
    if not os.path.isfile(fp):
        return {}, {}
    try:
        with open(fp, "r", encoding="utf-8") as f:
            d = json.load(f)
        return d.get("tag_to_groups", {}), d.get("group_to_tags", {})
    except Exception:
        return {}, {}


def _load_user_mappings():
    fp = os.path.join(_my_dir(), "user_tag_mappings.json")
    if not os.path.isfile(fp):
        return {}
    try:
        with open(fp, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


SUB_CATS = {
    "body_features": {"hair", "hair_color", "hair_styles", "eyes_tags", "skin_color", "body_parts"},
    "clothing": {"attire", "legwear", "handwear", "headwear"},
    "pose": {"posture", "gestures"},
    "expression": {"face_tags"},
    "background": {"backgrounds"},
    "accessories": {"accessories"},
    "other": {"image_composition", "lighting", "patterns", "visual_aesthetic", "colors", "focus_tags"},
}
ALL_SUB_KEYS = list(SUB_CATS.keys())


# 标签后缀 → 子类映射
_SUFFIX_RULES = [
    (["_hair", "_haired", "twintails", "ponytail", "ahoge", "bangs",
      "_eyes", "_eyebrow", "_eyelash",
      "_ear", "_ears", "_nose", "_lip", "_lips", "_tongue",
      "_breast", "_breasts", "_nipple", "_nipples",
      "_hand", "_hands", "_finger", "_fingers", "_arm", "_arms",
      "_foot", "_feet", "_leg", "_legs", "_thigh", "_thighs",
      "_skin", "_tail", "_wing", "_wings", "_horn", "_horns",
      "_cheek", "_chin", "_neck", "_waist", "_hip", "_hips",
      "_belly", "_navel", "_abs", "_muscle", "_muscles",
      "_fur", "_scales", "_fin", "_tentacle", "_tentacles"], "body_features"),
    (["_shirt", "_skirt", "_dress", "_boots", "_sleeves", "_necktie", "_collar",
      "_uniform", "_socks", "_stockings", "_pants", "_shorts", "_gloves",
      "_ribbon", "_jacket", "_coat", "_cape", "_hat", "_scarf", "_belt",
      "_bow", "_apron", "_shoe", "_sandals", "_loafers", "_heels",
      "_thighhighs", "_pantyhose", "_choker", "_bracelet", "_ring",
      "_trim", "_lace", "_frill", "_bowtie"], "clothing"),
    (["_pose", "sitting", "standing", "lying", "kneeling", "crouching",
      "spread_legs", "leg_up", "arms_up", "hand_up", "hands_up",
      "pointing", "waving", "gesture", "from_side", "from_behind",
      "from_above", "from_below", "full_body", "crotch_up"], "pose"),
    (["smile", "smirk", "frown", "pout", "blush", "angry", "sad",
      "happy", "teeth", "tongue_out", "open_mouth", "closed_mouth",
      "tear", "crying", "expressionless", "excited", "surprised",
      "embarrassed", "annoyed", "disgust"], "expression"),
    (["_background", "outdoors", "indoor", "night", "day", "sunset",
      "cityscape", "nature", "beach", "forest", "room", "street",
      "simple_background", "white_background", "gradient_background",
      "cloud", "sky"], "background"),
    (["_ornament", "_band", "_glass", "_glasses", "_headphone",
      "_headset", "_ribbon", "_pin", "_brooch", "sunglasses"], "accessories"),
]


def _pattern_match(tag):
    t = tag.lower()
    for suffixes, cat in _SUFFIX_RULES:
        for sfx in suffixes:
            if t == sfx or t.endswith("_" + sfx) or t.endswith(sfx):
                return cat
    return None


def _load_pattern_rules():
    fp = os.path.join(_my_dir(), "user_tag_patterns.json")
    if not os.path.isfile(fp):
        return {}
    try:
        with open(fp, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def classify_general(tags):
    tag_to_groups, _group_to_tags = _load_tag_groups()
    user_map = _load_user_mappings()
    pattern_rules = _load_pattern_rules()
    result = {k: [] for k in ALL_SUB_KEYS}
    uncategorized = []
    for tag in tags:
        if tag in user_map:
            cat = user_map[tag]
            if cat in result:
                result[cat].append(tag)
            else:
                uncategorized.append(tag)
            continue

        # 批量模式规则：tag 包含 keyword → 归入对应分类
        matched = False
        if pattern_rules:
            t_lower = tag.lower()
            for keyword, cat in pattern_rules.items():
                if keyword in t_lower:
                    result[cat].append(tag)
                    matched = True
                    break
        if matched:
            continue
        groups = tag_to_groups.get(tag, [])
        matched = False
        for sub_cat, group_names in SUB_CATS.items():
            if any(g in group_names for g in groups):
                result[sub_cat].append(tag)
                matched = True
                break
        if matched:
            continue
        cat = _pattern_match(tag)
        if cat:
            result[cat].append(tag)
        else:
            uncategorized.append(tag)
    return result, uncategorized


def re_split_tags(text):
    parts = re.split(r'[,，、\n]+', text)
    result = []
    for part in parts:
        for token in part.strip().split():
            token = token.strip()
            if token:
                result.append(token)
    return result


class DanbooruTagClassifier:
    """标签分类器：输入原始标签 → 自动查 category → 按 Anima 结构分到子类"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "原始标签": ("STRING", {
                    "multiline": True, "default": "",
                    "placeholder": "输入 Danbooru 标签，用逗号或空格分隔"
                }),
            },
            "optional": {
                "启用API查询": ("BOOLEAN", {"default": True}),
                "使用本地数据库": ("BOOLEAN", {"default": True}),
            }
        }

    RETURN_TYPES = (
        "STRING", "STRING", "STRING", "STRING", "STRING", "STRING",
        "STRING", "STRING", "STRING", "STRING", "STRING", "STRING", "STRING", "STRING",
    )
    RETURN_NAMES = (
        "全部标签", "质量/元标签", "计数标签", "角色标签",
        "系列标签", "画师标签",
        "身体特征标签", "服装标签", "姿势标签",
        "表情标签", "背景标签", "配饰标签",
        "其他标签",
        "未分类标签",
    )
    FUNCTION = "classify"
    CATEGORY = "Danbooru Anima"

    def classify(self, 原始标签="", 启用API查询=True, 使用本地数据库=True):
        if not 原始标签 or not 原始标签.strip():
            return ("", "", "", "", "", "", "", "", "", "", "", "", "")

        tags = re_split_tags(原始标签)

        category_map = {}
        if 启用API查询 and tags:
            try:
                category_map = get_tag_categories_batch(tags, use_local_db=使用本地数据库)
            except Exception:
                pass

        base = classify_tags(tags, category_map)
        sub, uncategorized = classify_general(base.get("general", []))

        return (
            ", ".join(base.get("all", [])),
            ", ".join(base.get("quality_meta", [])),
            ", ".join(base.get("count", [])),
            ", ".join(base.get("character", [])),
            ", ".join(base.get("series", [])),
            ", ".join(base.get("artist", [])),
            ", ".join(sub.get("body_features", [])),
            ", ".join(sub.get("clothing", [])),
            ", ".join(sub.get("pose", [])),
            ", ".join(sub.get("expression", [])),
            ", ".join(sub.get("background", [])),
            ", ".join(sub.get("accessories", [])),
            ", ".join(sub.get("other", [])),
            ", ".join(uncategorized),
        )


NODE_CLASS_MAPPINGS = {"DanbooruTagClassifier": DanbooruTagClassifier}
NODE_DISPLAY_NAME_MAPPINGS = {"DanbooruTagClassifier": "D站标签分类器 (Danbooru Tag Classifier)"}
