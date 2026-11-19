# QuickLook Fast

![QuickLook Fast 图标](public/branding/app.png)

**QuickLook Fast is real fast, but it's more powerful than others.**

QuickLook Fast 是离线优先的桌面文件预览工具。在文件管理器中选中文件，按空格即可查看，再按空格或 Esc 收起。它以前叫 SlowLook，基于 Electron、Chromium、TypeScript 和 [Flyfish File Viewer](https://github.com/flyfish-dev/file-viewer) 开发。感谢 Flyfish 团队和所有开源贡献者。

项目仍处于 **0.1.0 早期版本**。不同系统的文件管理器接入方式、文件格式和还原质量有差异，详见下文。

## 下载与启动

从 [GitHub Releases](https://github.com/Chaoleme-Studio/quick_look_fast/releases) 下载对应平台的归档，解压后运行：

| 平台 | 架构及系统版本 | 启动方式 |
| --- | --- | --- |
| Windows | Windows 10/11，x64 | 运行 `QuickLook Fast.exe`；程序常驻系统托盘。 |
| macOS | macOS 26 及以上，Apple Silicon / arm64 | 运行 `QuickLook Fast.app`；不提供 Intel 或旧版 macOS 构建。 |
| Linux | x64，GNOME 或 KDE Plasma | 运行 `./quicklook-fast`；发行版需满足 Electron 运行库要求。 |

这三类构建由 Release 工作流生成；系统和桌面环境的真实验证状态见[平台说明](docs/platforms.md)。macOS 目前仅使用临时签名，未做 Developer ID 签名和 Apple 公证。Linux 包是便携目录，不是 deb、rpm 或 AppImage。

首次使用：

1. 启动程序，在资源管理器中选中一个文件。
2. 在已接入的入口按 **Space** 预览；再次按 Space 或按 **Esc** 关闭。
3. 使用方向键尝试切换选中的文件；图钉可固定并置顶当前预览，再继续查看其他文件。
4. 关闭预览窗口不会退出程序；从托盘菜单选择“退出”才会完全退出。

Windows 支持 Explorer、桌面和 Directory Opus 的 Space 入口。也可拖放文件或文件夹、从窗口中选择，或通过 `"QuickLook Fast.exe" "完整路径"` 打开。其他平台的快捷键接入有所不同。

## 能预览什么

| 类别 | 功能和边界 |
| --- | --- |
| Office 与 PDF | Word、Excel、PowerPoint、PDF、OFD 等由 Flyfish 渲染；支持常见密码加密的 DOCX/XLSX/PPTX，复杂排版仍可能与原软件不同。 |
| 图片、音频、视频 | 图片支持滚轮缩放和部分 EXIF；音视频默认播放。音频波形可拖动进度，短小音频尝试提取真实波形，大文件使用标注的示意波形。 |
| 代码与文本 | 常见代码着色和行号，Markdown 左侧目录；大文本默认只读取片段，SRT 等可以文本方式预览。 |
| 文件夹与压缩包 | 文件夹分页、下钻、类型图标和可见图片缩略图；ZIP/RAR 按需读取目录和选中条目，支持常见密码。文件夹总大小暂不递归统计。 |
| 工程及其他格式 | 尝试预览 CAD、3D、设计文件、邮件、字体和结构化数据；不支持或无法解析的内容回退到文本或文件信息。 |

Flyfish 3.3.4 的完整目录登记 **275 个扩展名、47 条预览链路**。本项目使用 Full 基线并显式加载设计、二进制和签名渲染器，按当前注册信息有 **272 个扩展名的候选路由**；其中 6 类二进制扩展名当前优先显示文本或文件信息，因此约 **266 个**进入内容渲染候选。DICOM 和 BPMN 未接入。这是代码注册数量，**不是逐一实测通过的格式数**，也不保证每个文件都能完整还原。[上游格式清单](https://github.com/flyfish-dev/file-viewer/wiki/Supported-Formats) · [限制和验证](docs/compatibility.md)

## GNOME 与 KDE / Dolphin

Linux 解压后，运行下面的命令安装用户级文件管理器集成：

```sh
./install-integration.sh          # Dolphin / Nemo 服务菜单
./install-integration.sh --gnome  # 同时安装 GNOME Files 预览服务
```

GNOME Files 使用预览 D-Bus；KDE Dolphin 使用服务菜单，支持文件和文件夹。Dolphin **26.04 及以上**可在快捷键设置中为该菜单动作绑定 Space；更早版本可使用菜单，但不能保证同样的快捷键配置。KDE 的 Wayland 和 X11 会话均为目标环境，尚需实机验收。安装脚本不覆盖已有的同名用户级集成文件。[配置和限制](docs/platforms.md)

## 与 QuickLook、旧版 SlowLook 的关系

QuickLook Fast 是独立应用，**不是** QL-Win/C# QuickLook 的插件或原地升级包，不会自动导入其插件和设置。两者同时常驻可能竞争 Space 和方向键；要替换使用，请先从旧 QuickLook 的托盘菜单退出并关闭其开机启动，再启动本项目。PowerToys Peek 及 Directory Opus 自身的空格绑定也可能冲突。

旧版 SlowLook 也应先退出并关闭旧开机项。改名后应用身份和系统用户数据目录可能不同，旧设置不会自动迁移；Linux 若安装过旧服务菜单，可能需要手动移除旧菜单项。不会自动删除原软件或用户文件。[完整迁移说明](docs/platforms.md)

Flyfish 是本项目的上游渲染组件，不是需要同时启动的另一个预览程序。项目固定使用 3.3.4；构建时应用本地 PPTX 与 DOCX 兼容补丁。升级 Flyfish 时要同步检查 API、离线资源、补丁及回归测试，不能只替换一个文件。[上游更新与 Office 说明](docs/compatibility.md)

## 截图

<!-- screenshots:start -->

真实应用截图尚待生成。在可启动 Electron 的桌面执行 `npm run build` 和 `npm run screenshots`，检查图片后提交。

<!-- screenshots:end -->

截图脚本使用合成目录、合成 PDF 和公开 PPTX 样本，不读取真实工作文档。[截图说明](docs/screenshots/README.md)

## 技术路线与开发

Electron 45 + Chromium + TypeScript + Vite 8；Flyfish 3.3.4 提供主要格式渲染，ZIP/RAR、Office 解密和 EXIF 使用专用库。Node 本地文件服务支持 Range；大文本、目录和压缩包按需读取，但部分 Office、CAD 和媒体解码仍可能占用较多内存。Windows 使用 C# 桥接，macOS 使用 Finder 适配，GNOME 使用 D-Bus，Dolphin/Nemo 使用服务菜单。

```sh
npm ci
npm run build
npm test
npm run dev
npm run screenshots
npm run benchmark:file
npm run dist:win
```

构建需要 Node.js 24 和 npm；Windows 原生桥接需要 .NET Framework C# 编译器。`src/` 和 `electron/` 是应用源码，`native/` 和 `integrations/` 是平台接入，`tests/` 保存测试，`scripts/` 保存构建脚本。根目录的 `index.html` 是 Vite 的**源码入口**，构建后另生成 `dist/index.html`；它应当提交。`dist/`、`dist-electron/`、`artifacts/`、`node_modules/` 和本地 `references/` 都是生成物或本地研究材料，不提交。

[使用指南](docs/user-guide.md) · [架构与性能](docs/architecture.md) · [兼容性与 Office](docs/compatibility.md) · [平台接入](docs/platforms.md) · [需求与验证](docs/requirements-and-verification.md) · [打包发布](docs/releasing.md)

## 许可与社区

项目自有代码采用 [Apache-2.0](LICENSE)。第三方依赖按各自许可证分发，其中部分 Flyfish CAD 组件采用 AGPL-3.0-only，不能因为主项目使用 Apache-2.0 而忽略其要求。[第三方许可与素材](THIRD_PARTY.md)

组织：[www.chaoleme.cn](https://www.chaoleme.cn/) · 社区：[Linux DO](https://linux.do/)
