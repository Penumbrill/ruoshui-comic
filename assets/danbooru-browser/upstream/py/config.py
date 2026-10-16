"""
设置管理 - Danbooru 连接配置
"""
import json
import os

PLUGIN_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SETTINGS_FILE = os.path.join(PLUGIN_DIR, "settings.json")

# 常用 OpenAI 兼容模型预设
MODEL_PRESETS = {
    "deepseek": {"base_url": "https://api.deepseek.com/v1", "model": "deepseek-chat"},
    "openai": {"base_url": "https://api.openai.com/v1", "model": "gpt-4o-mini"},
    "qwen": {"base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1", "model": "qwen-turbo"},
    "glm": {"base_url": "https://open.bigmodel.cn/api/paas/v4", "model": "glm-4-flash"},
    "siliconflow": {"base_url": "https://api.siliconflow.cn/v1", "model": "Pro/deepseek-ai/DeepSeek-V3"},
    "moonshot": {"base_url": "https://api.moonshot.cn/v1", "model": "moonshot-v1-8k"},
}

DEFAULT_SETTINGS = {
    "danbooru_username": "",
    "danbooru_api_key": "",
    "page_size": 20,
    "blacklist_tags": "",
    "original_resolution": False,
}

def load_settings():
    """从本地文件加载所有设置"""
    try:
        if os.path.exists(SETTINGS_FILE):
            with open(SETTINGS_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
                for key, value in DEFAULT_SETTINGS.items():
                    data.setdefault(key, value)
                return data
    except Exception as e:
        print(f"[DanbooruAnima] 加载设置失败: {e}")
    return dict(DEFAULT_SETTINGS)

def save_settings(settings):
    """保存所有设置到本地文件"""
    try:
        with open(SETTINGS_FILE, 'w', encoding='utf-8') as f:
            json.dump(settings, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        print(f"[DanbooruAnima] 保存设置失败: {e}")
        return False
