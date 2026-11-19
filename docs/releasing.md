# 打包与发布

项目版本为 `0.1.2`。发布包按目标系统构建，打包脚本不会跨平台伪造可运行程序。Electron 45 不再在 `npm ci` 时自动下载运行时，构建便携包前需执行 `npm run electron:install`；发布工作流也显式执行该步骤。

| 平台 | 架构 / 版本 | 产物与限制 |
| --- | --- | --- |
| Windows | x64，Windows 10 及以上 | ZIP 内是便携目录及 `QuickLook Fast.exe`；未做发行者证书签名。 |
| macOS | arm64，macOS 26 及以上 | ZIP 内含 `QuickLook Fast.app`；临时自签名，未做 Developer ID 签名或 Apple 公证。 |
| Linux | x64 | `tar.gz` 内含便携目录、`quicklook-fast` 和可选集成安装脚本。 |

[Release 工作流](../.github/workflows/release.yml)只监听 Release `published`：普通提交、标签推送和未发布草稿不会触发。每个平台执行 `npm ci`、构建、打包与测试，将归档和 SHA-256 文件附加到 Release。需要仓库允许 Actions 写入 `contents`，不可变的 Release 不能追加文件。

0.1.1 的 Windows、Linux 和 macOS 作业已在 GitHub Actions 全部通过并上传归档。macOS 作业使用 `macos-26` arm64 运行器，检查 Bundle 的最低系统版本、临时签名，以及 Electron 的架构和版本；Node 模式检查不能替代图形界面和 Finder 的真机验收。GNOME/KDE、Wayland 和 X11 也需要在相应桌面验证。

Windows 本地打包使用 `npm run dist:win`。打包脚本只覆盖带有效所有权标记的自身生成目录，标记放在 `artifacts/` 中而不进入用户的文件列表，并保留项目许可和第三方许可证。Linux 解压后运行 `./quicklook-fast`；执行 `./install-integration.sh --gnome` 安装 GNOME 服务和 Dolphin/Nemo 菜单，省略 `--gnome` 只安装菜单。

`dist/` 是 Vite 前端构建结果，`dist-electron/` 是主进程和 preload 编译结果，`artifacts/` 是将 Electron、两部分构建结果和许可证组合后的发布目录；它们均已忽略，不需提交。根目录 `index.html` 则是 Vite 的源码入口，需要提交。
