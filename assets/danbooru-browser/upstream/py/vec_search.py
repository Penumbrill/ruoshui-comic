"""
vec_search.py - 语义搜索 HTTP API
==================================

为 Danbooru Browser 前端提供语义搜索端点。

流程：用户首次搜索 → 前端弹窗确认 → 调 /vec_init 开始下载 → 
      前端轮询 /vec_status 显示进度条 → 完成后自动搜索。

模型下载：
  🤗 HuggingFace: https://huggingface.co/BAAI/BGE-M3
  🇨🇳 国内: https://pan.quark.cn/s/e501b783f10f
  缓存下载也是同一网盘地址

路由：
  POST /danbooru_anima/vec_search    — 语义搜索
  GET  /danbooru_anima/vec_status    — 引擎状态 + 进度
  POST /danbooru_anima/vec_init      — 用户确认后启动初始化
  POST /danbooru_anima/vec_similar   — 相似标签推荐
  POST /danbooru_anima/vec_categorize — 标签分类推断
"""

from __future__ import annotations

import threading
from aiohttp import web

from server import PromptServer

from .tag_engine import DanbooruTagger, get_progress

# ── 引擎状态 ──────────────────────────────────────────

_engine_lock = threading.Lock()
_engine_ready = False
_engine_error: str | None = None
_engine_init_started = False


def _ensure_engine():
    """检查引擎是否已就绪（不自动启动）。"""
    global _engine_ready
    if _engine_ready:
        return True
    return False


def _start_init():
    """
    在后台线程启动初始化（由 /vec_init 调用，即用户确认后）。
    返回 True 表示本次是首次启动，False 表示已在运行。
    """
    global _engine_ready, _engine_error, _engine_init_started

    with _engine_lock:
        if _engine_ready:
            return False
        if _engine_init_started and not _engine_error:
            return False  # 已在运行
        # 重置错误状态允许重试
        _engine_init_started = True
        _engine_error = None

    def _init_worker():
        global _engine_ready, _engine_error, _engine_init_started
        try:
            print("[vec_search] 开始后台初始化 BGE-M3 引擎...")
            tagger = DanbooruTagger.get_instance()
            with _engine_lock:
                _engine_ready = tagger.is_loaded
                if not _engine_ready:
                    _engine_error = "引擎加载后状态异常"
                    DanbooruTagger._instance = None
        except Exception as e:
            DanbooruTagger._instance = None
            with _engine_lock:
                _engine_error = str(e)
            print(f"[vec_search] 引擎初始化失败: {e}")

    t = threading.Thread(target=_init_worker, daemon=True)
    t.start()
    return True


# ── 路由 ──────────────────────────────────────────────

def register_routes():

    @PromptServer.instance.routes.get("/danbooru_anima/vec_status")
    async def vec_status(request):
        """获取引擎状态 + 进度。前端轮询用。"""
        p = get_progress()
        with _engine_lock:
            return web.json_response({
                "ready": _engine_ready,
                "error": _engine_error,
                "phase": p["phase"],
                "percent": p["percent"],
                "message": p["message"],
                "model": "BAAI/bge-m3",
            })

    @PromptServer.instance.routes.post("/danbooru_anima/vec_init")
    async def vec_init(request):
        """用户确认初始化语义引擎。POST {}"""
        started = _start_init()
        p = get_progress()
        return web.json_response({
            "started": started,
            "phase": p["phase"],
            "percent": p["percent"],
            "message": p["message"],
        })

    @PromptServer.instance.routes.post("/danbooru_anima/vec_search")
    async def vec_search(request):
        """语义搜索：POST {"query": "猫耳女孩", "top_k": 20}"""
        try:
            body = await request.json()
        except Exception:
            return web.json_response({"error": "无效的 JSON 请求"}, status=400)

        query = (body.get("query") or "").strip()
        top_k = min(int(body.get("top_k", 20)), 100)

        if not query:
            return web.json_response({"tags": []})

        if not _ensure_engine():
            p = get_progress()
            return web.json_response({
                "tags": [],
                "need_init": True,
                "progress": p["message"],
            })

        tagger = DanbooruTagger.get_instance()
        results = tagger.semantic_search(query, top_k=top_k, score_threshold=0.15)

        return web.json_response({
            "tags": results,
            "query": query,
        })

    @PromptServer.instance.routes.post("/danbooru_anima/vec_similar")
    async def vec_similar(request):
        """相似标签推荐"""
        try:
            body = await request.json()
        except Exception:
            return web.json_response({"error": "无效的 JSON 请求"}, status=400)

        tag = (body.get("tag") or "").strip().lower()
        top_k = min(int(body.get("top_k", 10)), 50)

        if not tag:
            return web.json_response({"tags": []})

        if not _ensure_engine():
            p = get_progress()
            return web.json_response({"tags": [], "need_init": True, "progress": p["message"]})

        tagger = DanbooruTagger.get_instance()
        results = tagger.similar_tags(tag, top_k=top_k)
        return web.json_response({"tags": results})

    @PromptServer.instance.routes.post("/danbooru_anima/vec_categorize")
    async def vec_categorize(request):
        """标签分类推断"""
        try:
            body = await request.json()
        except Exception:
            return web.json_response({"error": "无效的 JSON 请求"}, status=400)

        tag = (body.get("tag") or "").strip().lower()
        if not tag:
            return web.json_response({"category": None})

        if not _ensure_engine():
            p = get_progress()
            return web.json_response({"category": None, "need_init": True, "progress": p["message"]})

        tagger = DanbooruTagger.get_instance()
        cat = tagger.guess_category(tag)

        cat_names = {0: "general", 1: "artist", 3: "copyright", 4: "character", 5: "meta"}
        return web.json_response({
            "category": cat,
            "category_name": cat_names.get(cat) if cat is not None else None,
        })

    print("[vec_search] 语义搜索路由已注册")
