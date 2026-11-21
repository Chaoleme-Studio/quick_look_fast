# 打包与发布

发布包按目标系统构建，打包脚本不会跨平台伪造可运行程序。安装依赖使用 `pnpm install --frozen-lockfile`，构建便携包前需执行 `pnpm run electron:install` 下载 Electron 运行时；发布工作流也显式执行该步骤。

| 平台 | 架构 / 版本 | 产物与限制 |
| --- | --- | --- |
| Windows | x64，Windows 10 及以上 | ZIP 内是便携目录及 `QuickLook Fast.exe`；未做发行者证书签名。 |
| macOS | arm64，macOS 26 及以上 | ZIP 内含 `QuickLook Fast.app`；临时自签名，未做 Developer ID 签名或 Apple 公证。 |
| Linux | x64 / arm64 | `tar.gz` 内含便携目录、`quicklook-fast` 和可选集成安装脚本；按系统架构选择下载包。 |

[Release 工作流](../.github/workflows/release.yml)只监听 Release `published`：普通提交、标签推送和未发布草稿不会触发。每个平台按 pnpm 锁文件安装依赖、构建、打包与测试，将归档和 SHA-256 文件附加到 Release。需要仓库允许 Actions 写入 `contents`，不可变的 Release 不能追加文件。

正式版的四个构建作业全部成功后，工作流会核对版本标签及已上传附件的大小、SHA-256，生成并附加 `update.json`。更新检查读取其中的版本和附件信息；没有清单的旧版发布仍可通过正式版本标签识别。清单用于检查版本和列出附件，当前不用于自动下载或安装，也没有单独的签名文件。

0.3.0 的 Windows x64、Linux x64、Linux arm64 和 macOS arm64 作业已在 GitHub Actions 通过并上传归档。macOS 作业使用 `macos-26` arm64 运行器，检查 Bundle 的最低系统版本、临时签名，以及 Electron 的架构和版本；Node 模式检查不能替代图形界面验收。Linux ARM64 包已在 Fedora 45、KDE Wayland、Dolphin 26.08.2 虚拟机测试文本文件的空格预览及冷启动；其他发行版、文件和桌面组合仍需分别验证。

Windows 本地打包使用 `pnpm run dist:win`。结果依次放在 `build/versions/V1`、`V2` 等目录；指定 `node scripts/pack-portable.cjs V13` 可创建未使用的编号。脚本拒绝覆盖已有版本。编号仅标识本机构建，与 `package.json` 中的语义版本不同。Linux 安装、Dolphin 快捷键与 GNOME 服务的步骤见[平台说明](platforms.md#linux)。

macOS 本地打包完成后，对生成的应用进行临时签名并验证；将示例中的 `V1` 替换为打包命令输出的目录：

```sh
codesign --force --deep --sign - "build/versions/V1/QuickLook Fast.app"
codesign --verify --deep --strict "build/versions/V1/QuickLook Fast.app"
```

`src/index.html` 是 Vite 源码入口。前端与 Electron 编译到 `build/dist/` 和 `build/dist-electron/`。Windows 原生程序编译到 `build/native/windows/`。macOS 构建使用 Xcode 的 Swift 工具链，将 Finder 监听程序编译到 `build/native/macos/` 并随应用打包。便携版集中在 `build/versions/`。

发布工作流在干净环境中使用 `build/versions/V1/`，再按 Release 标签命名归档和 SHA-256 文件；`V1` 不代表软件语义版本。Windows 打包时同时将 `electron_wer.dll` 重命名为 `QuickLook Fast_wer.dll`，以匹配可执行文件。默认不采集原生转储；诊断模式及隐私说明见[使用指南](user-guide.md#本地崩溃诊断)。

## 重建文档截图

安装依赖和 Electron 后，在有图形桌面的环境运行 `pnpm run build` 和 `pnpm run screenshots`。脚本打开实际预览界面，更新 `docs/screenshots/` 的五张图片以及根 README 中 `screenshots:start` 和 `screenshots:end` 标记之间的截图区域。跨平台文件夹截图展示放在标记之外，不会被脚本覆盖。

文件夹和 PDF 使用合成示例，PPTX 使用公开测试样本，应用图标来自用户提供的素材。原有五张截图来自 GitHub Windows 构建打开的 Electron 窗口；macOS 图片采集自本机应用。Linux 文件夹图采集自 Ubuntu 独立 Xvfb 会话中运行的 Linux Electron 窗口，使用合成目录，展示的是应用窗口内容，不含窗口管理器边框。Word 和 Excel 截图基于公开演示或项目合成的示例数据。三维截图采用自制建筑群白模以及 [Innerscene 的 CC0 近似建筑模型](https://www.innerscene.com/tools/library/3d-parts/empire-state-building-approximate-model-1-1000-tabletop-7e96c2b1)。提交截图时请保留 README 中的相对路径；可使用无损压缩减小 PNG 体积。
