"""
tag_engine.py - BGE-M3 语义搜索引擎
====================================

为 Danbooru 标签提供中文/英文混合语义搜索能力。

工作流程：
  1. 首次运行：加载 BGE-M3 模型，对 tags_enhanced.csv 中所有标签
     预计算三路 embedding（英文名/中文扩展词/释义），缓存到磁盘。
  2. 后续运行：直接从磁盘加载缓存（< 2 秒）。
  3. 查询时：将用户输入编码为向量，与三路矩阵做 cosine similarity，
     加权合并后返回 top-K 最匹配的标签。

依赖：
  - sentence-transformers >= 2.2.0
  - torch（ComfyUI 已自带）
  - safetensors
  - numpy（ComfyUI 已自带）
  - pandas
"""

from __future__ import annotations

import os
import csv
import time
import json
import re
import threading
from pathlib import Path
from typing import Optional

import torch
import numpy as np

# ── 可选依赖 ──────────────────────────────────────────
HAS_SENTENCE_TRANSFORMERS = False
try:
    from sentence_transformers import SentenceTransformer
    HAS_SENTENCE_TRANSFORMERS = True
except ImportError:
    SentenceTransformer = None  # type: ignore

HAS_PANDAS = False
try:
    import pandas as pd
    HAS_PANDAS = True
except ImportError:
    pd = None  # type: ignore

HAS_SAFETENSORS = False
try:
    from safetensors.torch import save_file as st_save, load_file as st_load
    HAS_SAFETENSORS = True
except ImportError:
    st_save = None  # type: ignore
    st_load = None  # type: ignore

# ── 路径 ──────────────────────────────────────────────

_PLUGIN_DIR = Path(__file__).resolve().parent.parent  # ComfyUI-Danbooru-Anima-Prompt/
_CSV_PATH = _PLUGIN_DIR / "tags_enhanced.csv"
_EMBEDDING_DIR = Path(__file__).resolve().parent / "tags_embedding"  # py/tags_embedding/
_EMBEDDING_DIR.mkdir(parents=True, exist_ok=True)

# ── 模型配置 ──────────────────────────────────────────

MODEL_ID = "BAAI/bge-m3"

# 本地模型目录（将模型文件直接放到插件目录下，无需在线下载）
# 目录: py/models/bge-m3/
# 模型下载地址: https://huggingface.co/BAAI/bge-m3
# 需要的文件: model.safetensors, config.json, tokenizer.json, modules.json 等
_LOCAL_MODEL_DIR = Path(__file__).resolve().parent / "models" / "bge-m3"

EMB_DIM = 1024  # BGE-M3 输出维度

# 三路 embedding 权重（查询语言自适应时会动态调整）
_WEIGHTS = {"en": 0.40, "cn": 0.35, "wiki": 0.25}
_CJK_RANGE = re.compile(r'[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]')

# ── 进度追踪 ──────────────────────────────────────────
_init_progress = {'phase': 'idle', 'percent': 0, 'message': '就绪'}

def update_progress(phase, percent, message):
    _init_progress.update({'phase': phase, 'percent': percent, 'message': message})

def get_progress():
    return dict(_init_progress)

# ── 缓存文件 ──────────────────────────────────────────

_CACHE_FILES = {
    "emb_en":      _EMBEDDING_DIR / "emb_en.safetensors",
    "emb_cn":      _EMBEDDING_DIR / "emb_cn.safetensors",
    "emb_wiki":    _EMBEDDING_DIR / "emb_wiki.safetensors",
    "metadata":    _EMBEDDING_DIR / "metadata.parquet",
    "meta_json":   _EMBEDDING_DIR / "meta.json",
}


def _has_cjk(text: str) -> bool:
    """检测文本是否包含中日韩字符"""
    return bool(_CJK_RANGE.search(text))


def _detect_lang(query: str) -> str:
    """
    简单语言检测：含 CJK 字符则倾向中文，否则英文。
    混合查询时动态调整权重。
    """
    if _has_cjk(query):
        return "cn"
    return "en"


# ═══════════════════════════════════════════════════════
# 核心引擎
# ═══════════════════════════════════════════════════════

class DanbooruTagger:
    """BGE-M3 语义搜索引擎（单例）"""

    _instance: Optional['DanbooruTagger'] = None
    _lock = threading.Lock()

    @classmethod
    def get_instance(cls, **kwargs) -> 'DanbooruTagger':
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    inst = cls(**kwargs)
                    inst.load()
                    cls._instance = inst
        return cls._instance

    @classmethod
    def is_ready(cls) -> bool:
        return cls._instance is not None and cls._instance.is_loaded

    def __init__(self, csv_path: str | None = None):
        self.csv_path = Path(csv_path) if csv_path else _CSV_PATH

        self.model: Optional['SentenceTransformer'] = None
        self.df: Optional['pd.DataFrame'] = None

        self.emb_en: Optional[torch.Tensor] = None      # [N, 1024]
        self.emb_cn: Optional[torch.Tensor] = None      # [N, 1024]
        self.emb_wiki: Optional[torch.Tensor] = None    # [N, 1024]

        self._name_to_idx: dict[str, int] = {}
        self.is_loaded = False

    # ── 公共 API ────────────────────────────────────

    def semantic_search(self, query: str, top_k: int = 20,
                        score_threshold: float = 0.0) -> list[dict]:
        """
        语义搜索：编码 query，与三路 embedding 矩阵计算 cosine 相似度。

        Args:
            query: 用户输入（中文/英文均可）
            top_k: 返回结果数
            score_threshold: 最低相似度阈值（0~1）

        Returns:
            [{name, cn_name, category, nsfw, post_count, score}, ...]
        """
        if not self.is_loaded or not query.strip():
            return []

        q_vec = self._encode(query)  # [1024]
        if q_vec is None:
            return []

        # L2 归一化
        q_vec = torch.nn.functional.normalize(q_vec, p=2, dim=0)

        lang = _detect_lang(query)
        if lang == "cn":
            w_en, w_cn = 0.30, 0.70
        else:
            w_en, w_cn = 0.70, 0.30

        scores = self._compute_mixed_scores(q_vec, w_en, w_cn)

        # 取 top-K
        top_scores, top_indices = torch.topk(scores, min(top_k, len(scores)))

        results = []
        for score, idx in zip(top_scores.tolist(), top_indices.tolist()):
            if score < score_threshold:
                continue
            row = self.df.iloc[idx]
            results.append({
                "name": row["name"],
                "cn_name": row.get("cn_name", ""),
                "category": int(row["category"]),
                "nsfw": bool(int(row["nsfw"])) if "nsfw" in row else False,
                "post_count": int(row["post_count"]) if "post_count" in row else 0,
                "score": round(score, 4),
            })

        return results

    def similar_tags(self, tag_name: str, top_k: int = 10) -> list[dict]:
        """
        给定一个已知标签名，返回语义上最相似的标签。

        Args:
            tag_name: 已有标签名（如 "1girl"）
            top_k: 返回结果数

        Returns:
            [{name, score}, ...]
        """
        if not self.is_loaded:
            return []
        idx = self._name_to_idx.get(tag_name.strip().lower())
        if idx is None:
            return []

        # 用该标签的 embedding 做查询向量
        vec = self.emb_en[idx]  # [1024]
        # 与全量矩阵计算相似度
        scores = torch.matmul(self.emb_en, vec)  # cos sim（已归一化）
        top_scores, top_indices = torch.topk(scores, min(top_k + 1, len(scores)))

        results = []
        for score, i in zip(top_scores.tolist(), top_indices.tolist()):
            if i == idx:
                continue  # 排除自身
            if len(results) >= top_k:
                break
            results.append({
                "name": self.df.iloc[i]["name"],
                "score": round(score, 4),
            })
        return results

    def guess_category(self, tag_name: str) -> int | None:
        """
        通过 embedding 近邻推断标签的分类。

        对不在本地数据库中的标签，找出语义最接近的 5 个已知标签，
        用它们的 category 做加权投票。

        Returns:
            category_id (0~5) 或 None（引擎未就绪 / 找不到近邻）
        """
        if not self.is_loaded:
            return None

        q_vec = self._encode(tag_name)
        if q_vec is None:
            return None
        q_vec = torch.nn.functional.normalize(q_vec, p=2, dim=0)

        scores = torch.matmul(self.emb_en, q_vec)
        top_scores, top_indices = torch.topk(scores, min(10, len(scores)))

        # 加权投票
        votes: dict[int, float] = {}
        for score, idx in zip(top_scores.tolist(), top_indices.tolist()):
            cat = int(self.df.iloc[idx]["category"])
            votes[cat] = votes.get(cat, 0) + score

        if not votes:
            return None
        return max(votes, key=votes.get)

    # ── 初始化 ──────────────────────────────────────

    def load(self) -> None:
        """同步加载：模型 + embedding 缓存。"""
        if self.is_loaded:
            return
        t0 = time.time()

        # 1) 加载或下载 / 构建 embedding 缓存
        update_progress('model', 2, '准备加载 BGE-M3 模型...')
        if self._cache_exists():
            print(f"[BGE-M3] 加载 embedding 缓存...")
            update_progress('cache', 5, '加载 embedding 缓存...')
            self._load_from_cache()
            need_build = False
        else:
            print(f"[BGE-M3] 未找到本地缓存，开始构建（约 1~2 分钟）...")
            need_build = True

        # 2) 加载模型（即使命中缓存也需要，用于编码查询）
        update_progress('model', 10, '加载 BGE-M3 模型...')
        self._load_model()

        # 从缓存加载的矩阵在模型就绪后移到同一设备
        if not need_build and self.model is not None:
            dev = self.model.device
            self.emb_en = self.emb_en.to(dev)
            self.emb_cn = self.emb_cn.to(dev)
            print(f"[BGE-M3] 矩阵已移到 {dev}")

        if need_build:
            update_progress('embeddings', 35, '构建标签嵌入向量（约 1~2 分钟）...')
            self._build_all()
            update_progress('embeddings', 90, '嵌入向量构建完成')

        # 3) 重建名称→索引映射
        if self.df is not None and 'name' in self.df.columns:
            self._name_to_idx = {
                row['name'].strip().lower(): i
                for i, row in self.df.iterrows()
            }

        self.is_loaded = True
        update_progress('ready', 100, '就绪')
        print(f"[BGE-M3] 引擎就绪，耗时 {time.time() - t0:.1f}s")

    def _load_model(self) -> None:
        """加载 SentenceTransformer 模型。"""
        if self.model is not None:
            return
        if not HAS_SENTENCE_TRANSFORMERS:
            print("[BGE-M3] sentence-transformers 未安装！请执行: pip install sentence-transformers")
            return

        device = 'cuda' if torch.cuda.is_available() else 'cpu'
        print(f"[BGE-M3] 加载模型 {MODEL_ID} (device={device})...")
        t0 = time.time()

        # 优先使用插件目录下的本地模型
        if _LOCAL_MODEL_DIR.is_dir() and (_LOCAL_MODEL_DIR / "config.json").is_file():
            model_src = str(_LOCAL_MODEL_DIR)
            print(f"[BGE-M3] 使用本地模型: {_LOCAL_MODEL_DIR}")
        else:
            model_src = MODEL_ID
            update_progress('model', 15, '正在下载 BGE-M3 模型（首次约 2-3 分钟）...')
            print(f"[BGE-M3] 在线加载模型: {MODEL_ID}")
            print(f"[BGE-M3] 如需离线，将模型下载到: {_LOCAL_MODEL_DIR}")
            print(f"[BGE-M3] 下载地址: https://huggingface.co/BAAI/bge-m3")

        self.model = SentenceTransformer(
            model_src,
            device=device,
            trust_remote_code=True,
        )
        update_progress('model', 30, '模型加载完成')
        print(f"[BGE-M3] 模型加载完成，耗时 {time.time() - t0:.1f}s")

        # 从 HuggingFace 加载后，保存一份到插件本地目录（方便离线/查看）
        if model_src == MODEL_ID:
            try:
                _LOCAL_MODEL_DIR.mkdir(parents=True, exist_ok=True)
                self.model.save_pretrained(str(_LOCAL_MODEL_DIR))
                print(f"[BGE-M3] 模型已保存到本地: {_LOCAL_MODEL_DIR}")
            except Exception as e:
                print(f"[BGE-M3] 保存本地模型失败（非致命）: {e}")

    def _encode(self, text: str) -> torch.Tensor | None:
        """编码单条文本为向量。"""
        if self.model is None:
            return None
        # BGE-M3 的 query 指令（与 model 版本匹配）
        # 新版 BGE-M3 自动处理 instruction，不需要手动加前缀
        emb = self.model.encode(
            text,
            normalize_embeddings=False,
            convert_to_tensor=True,
            show_progress_bar=False,
            device=self.model.device,
        )
        return emb

    def _batch_encode(self, texts: list[str], desc: str = "") -> torch.Tensor:
        """批量编码文本列表。"""
        if self.model is None:
            raise RuntimeError("Model not loaded")
        embs = self.model.encode(
            texts,
            normalize_embeddings=False,
            convert_to_tensor=True,
            show_progress_bar=True,
            batch_size=256,
            device=self.model.device,
        )
        return embs

    # ── 缓存管理 ────────────────────────────────────

    def _cache_exists(self) -> bool:
        return (
            _CACHE_FILES["emb_en"].is_file()
            and _CACHE_FILES["metadata"].is_file()
        )


    def _convert_remote_cache(self) -> None:
        """将 DanbooruSearchOnline 的多层单文件拆成我们格式的 3 个文件。"""
        src = _EMBEDDING_DIR / "danbooru_multiview_embeddings.safetensors"
        if not src.is_file():
            return
        print(f"[BGE-M3]  转换缓存格式...")
        try:
            from safetensors import safe_open
            from safetensors.torch import save_file
            tensors = {}
            with safe_open(str(src), framework="pt") as f:
                for key in f.keys():
                    tensors[key] = f.get_tensor(key)

            # 我们只用 en / cn / wiki 三层（cn_core 是额外 bonus）
            save_file({"emb_en": tensors["emb_en"]}, str(_CACHE_FILES["emb_en"]))
            save_file({"emb_cn": tensors["emb_cn"]}, str(_CACHE_FILES["emb_cn"]))
            save_file({"emb_wiki": tensors["emb_wiki"]}, str(_CACHE_FILES["emb_wiki"]))

            # metadata parquet 直接改名
            meta_src = _EMBEDDING_DIR / "tags_metadata.parquet"
            meta_dst = _CACHE_FILES["metadata"]
            if meta_src.is_file() and meta_src != meta_dst:
                import shutil
                shutil.copy2(meta_src, meta_dst)

            # 删除原始大文件
            src.unlink()
            meta_src.unlink()
            print(f"[BGE-M3]  转换完成")
        except Exception as e:
            print(f"[BGE-M3]  转换失败: {e}")
            # 清理失败的文件
            for p in _CACHE_FILES.values():
                if p.is_file():
                    p.unlink()

    def _build_all(self) -> None:
        """
        首次构建：读取 CSV → 编码 → 保存缓存。
        """
        if not self.csv_path.is_file():
            raise FileNotFoundError(f"CSV 文件不存在: {self.csv_path}")

        print(f"[BGE-M3] 读取标签数据: {self.csv_path.name}...")
        # 自动检测编码（兼容 GBK/UTF-8）
        _csv_encodings = ["utf-8-sig", "utf-8", "gbk", "gb2312", "gb18030", "latin-1"]
        _csv_encoding = "utf-8-sig"
        raw = self.csv_path.read_bytes()
        for enc in _csv_encodings:
            try:
                raw.decode(enc)
                _csv_encoding = enc
                break
            except (UnicodeDecodeError, UnicodeError):
                continue
        print(f"[BGE-M3] CSV 编码: {_csv_encoding}")
        rows = []
        with self.csv_path.open("r", encoding=_csv_encoding) as f:
            reader = csv.DictReader(f)
            for row in reader:
                rows.append({
                    "name": row.get("name", "").strip(),
                    "cn_name": row.get("cn_name", "").strip(),
                    "wiki": row.get("wiki", "").strip(),
                    "post_count": int(row.get("post_count", 0) or 0),
                    "category": int(row.get("category", 0) or 0),
                    "nsfw": int(row.get("nsfw", 0) or 0),
                })
        print(f"[BGE-M3] 共 {len(rows)} 个标签")

        # 提取两路文本（跳过 wiki，编码太慢且权重低）
        en_texts = [r["name"] for r in rows]
        cn_texts = [r["cn_name"].split(",")[0].strip() if r["cn_name"] else r["name"] for r in rows]

        print(f"[BGE-M3] 编码英文名...")
        emb_en = self._batch_encode(en_texts)
        print(f"[BGE-M3] 编码中文名...")
        emb_cn = self._batch_encode(cn_texts)

        # L2 归一化（方便后续 matmul 得到 cosine sim）
        dev = self.model.device if self.model is not None else 'cpu'
        self.emb_en = torch.nn.functional.normalize(emb_en, p=2, dim=1).to(dev)
        self.emb_cn = torch.nn.functional.normalize(emb_cn, p=2, dim=1).to(dev)
        self.emb_wiki = None
        print(f"[BGE-M3] 矩阵已移到 {dev}")

        # 保存缓存
        self._save_cache(rows)

        # 构造 DataFrame
        if HAS_PANDAS:
            self.df = pd.DataFrame(rows)
        else:
            self._df_from_rows(rows)

    def _save_cache(self, rows: list[dict]) -> None:
        """保存 embedding 缓存到磁盘。"""
        _EMBEDDING_DIR.mkdir(parents=True, exist_ok=True)
        print(f"[BGE-M3] 保存缓存到 {_EMBEDDING_DIR}...")

        if HAS_SAFETENSORS:
            st_save({"emb_en": self.emb_en}, str(_CACHE_FILES["emb_en"]))
            st_save({"emb_cn": self.emb_cn}, str(_CACHE_FILES["emb_cn"]))
        else:
            torch.save(self.emb_en, str(_CACHE_FILES["emb_en"]))
            torch.save(self.emb_cn, str(_CACHE_FILES["emb_cn"]))

        # metadata 用 parquet（或 json fallback）
        if HAS_PANDAS:
            df = pd.DataFrame(rows)
            df.to_parquet(_CACHE_FILES["metadata"], index=False)
        else:
            with open(_CACHE_FILES["meta_json"], "w", encoding="utf-8") as f:
                json.dump(rows, f, ensure_ascii=False)

        # 标量元数据
        with open(_CACHE_FILES["meta_json"], "w", encoding="utf-8") as f:
            json.dump({
                "num_tags": len(rows),
                "emb_dim": EMB_DIM,
                "model_id": MODEL_ID,
                "layers": ["en", "cn", "wiki"],
            }, f, ensure_ascii=False)

        print(f"[BGE-M3] 缓存保存完成")

    def _load_from_cache(self) -> None:
        """从磁盘加载 embedding 缓存。"""
        def _load_tensor(path: Path) -> torch.Tensor:
            if not path.is_file():
                raise FileNotFoundError(f"缓存文件不存在: {path}")
            if HAS_SAFETENSORS:
                return st_load(str(path))[list(st_load(str(path)).keys())[0]]
            return torch.load(str(path), map_location="cpu", weights_only=True)

        print(f"[BGE-M3] 加载 embedding 矩阵...")
        self.emb_en = _load_tensor(_CACHE_FILES["emb_en"])
        self.emb_cn = _load_tensor(_CACHE_FILES["emb_cn"])
        self.emb_wiki = None

        # 加载 metadata
        if HAS_PANDAS and _CACHE_FILES["metadata"].is_file():
            self.df = pd.read_parquet(_CACHE_FILES["metadata"])
        elif _CACHE_FILES["meta_json"].is_file():
            self._df_from_rows(None)
        else:
            raise FileNotFoundError("metadata 缓存文件不存在")

        print(f"[BGE-M3] 矩阵加载完成: {self.emb_en.shape[0]} 标签 × {self.emb_en.shape[1]} 维")

        # 移到模型设备（避免 CPU/GPU 不匹配）
        if self.model is not None:
            dev = self.model.device
            self.emb_en = self.emb_en.to(dev)
            self.emb_cn = self.emb_cn.to(dev)
            print(f"[BGE-M3] 矩阵已移到 {dev}")

    def _df_from_rows(self, rows: list[dict] | None) -> None:
        """无需 pandas 时用简单 dict 模拟 DataFrame"""
        if rows is None and _CACHE_FILES["meta_json"].is_file():
            with open(_CACHE_FILES["meta_json"], "r", encoding="utf-8") as f:
                data = json.load(f)
            rows = data if isinstance(data, list) else []

        class _RowProxy:
            """简易行代理，支持 .name / .iloc[idx] 风格的访问"""
            def __init__(self, data: dict):
                self._data = data
            def __getitem__(self, key):
                return self._data[key]
            def get(self, key, default=None):
                return self._data.get(key, default)

        class _Df:
            def __init__(self, rows):
                self._rows = rows
                self.columns = list(rows[0].keys()) if rows else []
            def iloc(self, idx):
                return _RowProxy(self._rows[idx])
            def __len__(self):
                return len(self._rows)

        self.df = _Df(rows)  # type: ignore

    # ── 辅助 ────────────────────────────────────────

    def _compute_mixed_scores(self, q_vec: torch.Tensor,
                               w_en: float, w_cn: float, w_wiki: float = 0.0) -> torch.Tensor:
        """两路加权余弦相似度"""
        scores = torch.zeros(self.emb_en.shape[0], dtype=torch.float32, device=self.emb_en.device)
        if self.emb_en is not None:
            scores += w_en * torch.matmul(self.emb_en, q_vec)
        if self.emb_cn is not None:
            scores += w_cn * torch.matmul(self.emb_cn, q_vec)
        return scores
