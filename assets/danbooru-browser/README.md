# ComfyUI-Danbooru-Anima-Prompt

一个 ComfyUI 插件，用于识别 Danbooru 标签并按 **Anima** 的 prompt 结构分类输出。

## 节点

### ① Danbooru Browser 🖼️

内嵌 Danbooru 搜索浏览器，在节点面板中直接搜索/浏览 Danbooru 图片，选中后自动获取其标签并按 Anima 结构分类输出。

**输出：**
- `image` — 选中图片
- `all_tags` — 全部标签
- `quality_meta_tags` — 质量/元/年份/安全标签
- `count_tags` — 人物计数标签（1girl, 1boy 等）
- `character_tags` — 角色标签
- `series_tags` — 系列/版权标签
- `artist_tags` — 画师标签
- `general_tags` — 通用标签

### ② Danbooru Tag Classifier 🏷️

接收原始标签字符串（来自 WD14 Tagger 等），自动查询 Danbooru API 获取标签分类，按 Anima 结构输出。

**输入：** `raw_tags` — 原始标签文本
**输出：** 同上 7 个接口

### ③ Anima Prompt Builder 🔗

接收 6 路分类标签，按 Anima 顺序拼接为最终 prompt。

**Anima 顺序：** `[quality/meta/year/safety] [count] [character] [series] [artist] [general]`

## 安装

将插件压缩包解压到 ComfyUI 的 `custom_nodes/` 目录下：

1. 下载 `ComfyUI-Danbooru-Anima-Prompt.zip`
2. 解压到 `ComfyUI/custom_nodes/` 目录
3. 确认目录结构为 `ComfyUI/custom_nodes/ComfyUI-Danbooru-Anima-Prompt/`
4. 重启 ComfyUI

> 如遇到依赖缺失，在插件目录下运行：`pip install -r requirements.txt`

## 依赖

- `requests`
- `Pillow`
- `torch`
- `numpy`

（这些通常 ComfyUI 已自带）

## 可选：BGE-M3 语义搜索引擎（🧠 按钮）

Danbooru Browser 搜索栏的 🧠 按钮启用 **BGE-M3 语义搜索**，输入中文/英文描述即可匹配语义相近的 Danbooru 标签（如搜"红头发女孩"命中 `red_hair` + `1girl`）。

> 需要额外安装依赖：`pip install sentence-transformers pandas safetensors`（已在 requirements.txt 中）

### 首次使用（自动下载）

点 🧠 按钮后，插件会在后台自动从 HuggingFace 下载 BGE-M3 模型（~2.2GB），然后对所有标签预计算 embedding 缓存（~560MB），总耗时约 2-3 分钟，**只在首次执行**。后续启动直接加载缓存，< 2 秒。

完成后在 ComfyUI 控制台可看到：
```
[vec_search] BGE-M3 引擎初始化完成
```

### 网络不好的用户：手动下载模型

如果自动下载太慢或经常中断，可以手动下载模型后直接放入插件目录：

**步骤：**

1. 从 https://huggingface.co/BAAI/bge-m3 下载模型文件
   （需要 `model.safetensors`、`config.json`、`tokenizer.json`、`modules.json` 等）

2. 放入以下目录（已存在，直接放文件就行）：

   ```
   ComfyUI/custom_nodes/ComfyUI-Danbooru-Anima-Prompt/
     py/
       models/
         bge-m3/              ← 目录已有，放文件进去
           model.safetensors  ← 放入下载的文件
           config.json
           tokenizer.json
           modules.json
           ...
   ```

3. 重启 ComfyUI，控制台应输出：
   ```
   [BGE-M3] 使用本地模型: ...\\py\\models\\bge-m3
   ```

> 不需要建目录、不需要设环境变量，文件放对位置就行。

### 删除重建 embedding 缓存

如果 embedding 缓存损坏或想换模型版本，删除以下目录即可，插件重启后会自动重建：

```
ComfyUI-Danbooru-Anima-Prompt/py/tags_embedding/
```

### 一键安装依赖

```bash
cd ComfyUI/custom_nodes/ComfyUI-Danbooru-Anima-Prompt
pip install -r requirements.txt
```

## 可选：本地标签数据库（加速分类）

Tag Classifier 节点默认通过 Danbooru API 在线查询标签分类。
如果下载本地标签数据库，大部分标签将直接在本地查表，无需 API 请求，**速度更快、无需联网、无频率限制**。

### 下载方式

```bash
# 进入插件目录
cd ComfyUI/custom_nodes/ComfyUI-Danbooru-Anima-Prompt

# 下载 tags_enhanced.csv（来自 DanbooruSearchOnline 项目）
curl -L -o tags_enhanced.csv "https://raw.githubusercontent.com/SuzumiyaAkizuki/DanbooruSearchOnline/main/origin_database/tags_enhanced.csv"
```

或手动从 [DanbooruSearchOnline](https://github.com/SuzumiyaAkizuki/DanbooruSearchOnline/blob/main/origin_database/tags_enhanced.csv) 下载后放到插件根目录。

### 使用

下载后重启 ComfyUI，Tag Classifier 节点的「启用本地标签数据库」默认开启。本地查不到的标签会自动 fallback 到 API 查询。

如需关闭，在节点上将开关设为 `False` 即可。
