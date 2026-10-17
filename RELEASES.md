# Ruoshui Comic v0.1.0

若水漫画是面向 Windows 的本地 AI 漫画创作软件，提供图像生成、局部重绘、分镜排版、文字对白与漫画导出功能。

Ruoshui Comic is a local AI comic studio for Windows, with image generation, inpainting, panel layouts, dialogue and comic export.

## 更新内容 / What's new

- 修复便携安装后的翻译与标签浏览器问题，支持含中文的安装路径。
- 首次启动自动准备中英双向翻译模型；使用向导仅在首次启动显示。
- 项目 ZIP 可携带图像、字体、图层、生成参数和编辑状态，导入后继续编辑。
- 新增项目关闭确认，以及可选择保留图片的项目删除功能。
- 项目和图片回收区支持恢复、永久删除；设置中提供一键清空入口。
- 完善英文界面，并修复整合包合并解压时的重复文件问题。

- Fixed translation and tag browsing in portable installations, including installation paths containing Chinese characters.
- Translation models are prepared automatically on first launch. The getting-started guide appears once and remains available from the sidebar.
- Project ZIPs include images, fonts, layers, generation parameters and editing state for continued editing after import.
- Added project-close confirmation and a choice to keep images when deleting a project.
- Project and image recycle bins support restoration and permanent deletion, with an empty-bin action in Settings.
- Improved the English interface and fixed duplicate files when extracting the portable packages.

## 下载与安装 / Download and installation

### 安装器 / Installer

下载并运行 **`ruoshui-comic.exe`**，选择安装文件夹。安装器会下载程序和独立运行环境，并完成校验与安装。

Download and run **`ruoshui-comic.exe`**, then choose an installation folder. The installer downloads, verifies and installs the application and its independent runtime.

### 便携版 / Portable installation

将以下 **5 个 ZIP** 全部解压到同一个文件夹，然后运行 **`若水漫画.exe`**：

Extract all **five ZIP files** below into the same folder, then run **`若水漫画.exe`**:

| 文件 / File | 内容 / Contents |
| --- | --- |
| `ruoshui-comic-update-win-x64.zip` | 主程序 / Application |
| `ruoshui-runtime-win-x64-01.zip` | 运行环境 1 / Runtime part 1 |
| `ruoshui-runtime-win-x64-02.zip` | 运行环境 2 / Runtime part 2 |
| `ruoshui-runtime-win-x64-03.zip` | 运行环境 3 / Runtime part 3 |
| `ruoshui-runtime-win-x64-04.zip` | 运行环境 4 / Runtime part 4 |

`ruoshui-setup-guide.zip` 为可选的安装说明和校验工具包。图像生成模型可在软件内下载。

`ruoshui-setup-guide.zip` contains optional installation instructions and verification tools. Image-generation models can be downloaded from within the app.

## 使用说明 / Documentation

[中文说明](https://github.com/Penumbrill/ruoshui-comic/blob/main/README.md) · [English guide](https://github.com/Penumbrill/ruoshui-comic/blob/main/README.en.md) · [问题反馈 / Report an issue](https://github.com/Penumbrill/ruoshui-comic/issues)
