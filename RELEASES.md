# 发布说明 / Release notes

## 修复更新 / Fixes · 2026-10-18

- 修复整合包中的翻译依赖和中文路径兼容问题；首次启动自动下载中译英与英译中模型。
- 修复标签浏览器在正式安装包中无法启动的问题，并补齐英文界面文案。
- 使用向导仅在首次启动显示，之后仍可手动打开。
- 设置新增回收区入口、一键清空及永久删除确认；项目和图片均可恢复，回收区不会自动清理。
- 项目标签新增关闭按钮和保存确认；删除项目时可选择保留图片或一并回收关联内容，自动保留其他项目使用的图片。
- 项目导出改为完整 ZIP，包含图片、贴图、字体、生成与重绘参数、候选图、遮罩和最后编辑状态；导入后恢复原布局及双击编辑入口。
- 说明包使用独立子文件夹，重新构建 ZIP 时清除旧条目，避免跨包重复文件。

- Fixed packaged translation dependencies and Windows paths containing Chinese characters. Both translation models download automatically on first launch.
- Fixed the packaged tag browser and completed English interface copy.
- Show the getting-started guide only on first launch; it remains available from the sidebar.
- Added recycle-bin access, restore controls and confirmed permanent cleanup in Settings. Recycled content is never cleared automatically.
- Added project-tab close buttons with a save confirmation. Project deletion can keep images or recycle related content while preserving images used by other projects.
- Export complete project ZIPs with images, stickers, fonts, generation and inpainting parameters, candidates, masks and the last editor state. Import restores the layout and double-click editing behavior.
- Put installation instructions in a separate subfolder and create fresh ZIPs to prevent duplicate entries across packages.

## 首次公开预览 / First public preview

### 中文

- 单图生成、局部重绘与漫画分开保存；分镜窗口独立保存参数并回填结果。
- 多边形及斜框、透明主体破框、自动对齐原图、对白粘连及丰富贴纸。
- 中英文字体、自定义字体导入、横竖排文字和文本格式工具。
- 预览滚轮缩放、圆形修边画笔、参数滚轮调整和恢复默认值。
- 优化弹窗、参数布局、图层菜单及半透明参考框；修复主体抠图白色接缝与缺失图片恢复。
- 漫画 PNG 自动按项目名称创建导出子文件夹，并提供打开文件夹按钮。
- 小型联网安装器与离线 ZIP 包，自动切换网络线路、续传并校验 SHA-256。
- 安装位置可选其他盘，自动添加用户 PATH，卸载仅清理本软件添加的项。
- 软件启动自动检查 PATH，设置内可检测修复；预览区新增明显的图片上传按钮与文件拖放。
- 所有包均不含模型、作品和私人设置；模型按需下载到当前安装位置。

完整下载方法与空间要求见 [中文说明](README.md)。这是公开预览，尚未覆盖所有硬件和网络环境；实际生成能力取决于显卡、模型与配置。

### English

- Separate standalone generation/inpainting from comics; panel windows preserve parameters and fill their target panel.
- Polygon/slanted panels, cutout overflow, alignment to source images, linked dialogue and more stickers.
- Chinese/English fonts, font import, horizontal/vertical writing and formatting tools.
- Preview wheel zoom, circular refinement brushes, numeric wheel controls and parameter resets.
- Improved dialogs, layouts, layer menus and translucent reference overlays; fixed cutout seams and image recovery.
- Project-named PNG export folders and an open-folder button.
- Small online installer and offline ZIPs, network fallback, resumable downloads and SHA-256 verification.
- Select an installation drive, automatically register user PATH and remove only the installer-owned entry on uninstall.
- Automatic PATH checks inside the desktop app, a repair button in Settings, visible image upload controls and drag-and-drop import.
- No model weights, artwork or personal settings bundled. Models download into the current installation directory.

See the [English guide](README.en.md) for installation. This is a public preview; hardware and network coverage is incomplete. Generation depends on your GPU, models and local configuration.
