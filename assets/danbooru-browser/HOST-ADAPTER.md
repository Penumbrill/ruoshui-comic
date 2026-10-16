# 桌面宿主边界

用户要求浏览器功能与本机 ComfyUI-Danbooru-Anima-Prompt 一致。不得重新实现或改写搜索、评分筛选、分类、收藏、合并、分序号融合和语义搜索规则。

- `danbooru_browser.original.js` 是上游原文件。实际加载的 `danbooru_browser.js` 只替换两个宿主导入路径。
- `upstream/py` 保留原后端代码；`UPSTREAM.json` 记录摘要。兼容测试校验字节一致性。
- `assets/danbooru_host.py` 提供 ComfyUI 路由注册和用户目录接口，在 `works/danbooru/upstream` 中运行原代码。标签输出直接调用原 `DanbooruBrowser.browse`，不自行计算多选和融合结果。
- `host.js` 处理 DOM 布局、桌面输出通信、失败图片提示和单张重试。CSS 只改变排版，不改变筛选事件或结果。
- 用户另行要求移除设置窗口底部的 B 站、YouTube、CivitAI、RH 外链和分类表、索引按钮。这一行由外层 CSS 隐藏；原处理函数及第三方署名资料仍保留。
- 远程请求通过桌面网络适配器正常使用系统代理；本机通信直连。HTTPS 始终验证证书。图片代理保留原 URL，识别实际格式，限制完整下载的并发数，区分权限、缺失、网关和非图片响应。不会通过改变搜索结果掩盖加载错误。
- 设置、收藏、索引更新、缓存和日志全部写入 `works`。不读取其他 ComfyUI 安装的私人配置、收藏或 API 密钥。
- 语义搜索采用原初始化流程，需要原版所需的依赖和 BGE-M3 权重；未安装时不伪造可用状态。

验证：`node --test --test-isolation=none tests/danbooru-compat.test.mjs`。真实 Python 宿主测试覆盖数组及字符串形式的全部 16 种评分组合、搜索操作符、分页、图片 URL、中文索引、收藏分组，以及原单选、多选和分序号融合输出。

上游 README、作者链接及第三方数据许可证保留在此目录。此宿主适配不改变上游授权条件。
