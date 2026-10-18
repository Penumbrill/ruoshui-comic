# 桌面宿主适配说明

标签浏览器沿用上游的搜索、评分筛选、分类、收藏、合并、分序号融合和语义搜索规则。桌面宿主负责本地运行、界面适配与网络通信。

- `danbooru_browser.original.js` 保留上游原文件，`danbooru_browser.js` 替换两个宿主导入路径。
- `upstream/py` 保留原后端代码，`UPSTREAM.json` 记录来源与文件摘要。
- `assets/danbooru_host.py` 提供路由注册和数据目录接口，在 `works/danbooru/upstream` 中运行后端。标签输出调用 `DanbooruBrowser.browse`。
- `host.js` 处理布局、桌面输出通信、失败图片提示和单张重试。样式调整不改变筛选事件或搜索结果。
- `locale.js` 与 `locale-en.json` 根据宿主语言切换浏览器界面文案，保留提示词、帖子内容和用户输入。
- 桌面界面精简设置窗口底部的外链与分类、索引导航入口；原处理函数及第三方来源资料保留在源码中。
- 远程请求通过桌面网络适配器使用系统代理，本机通信直连。HTTPS 请求验证证书。图片代理保留原 URL，并处理格式识别、并发限制和加载错误。
- 设置、收藏、索引更新、缓存和日志写入当前软件的 `works` 目录，与其他安装实例独立。
- 语义搜索需要相应依赖和 BGE-M3 权重，可用状态由实际安装情况决定。

兼容性测试：`node --test --test-isolation=none tests/danbooru-compat.test.mjs`。

上游 README、作者链接及第三方数据许可证保留在此目录。宿主适配不改变上游授权条件。
