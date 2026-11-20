# 参考项目与研究

## QuickLook 产品与架构调研

初次调研于 2026-11-18。目标是在现有文件管理器中快速预览多格式文件，而不是重新制作文件管理器。调查时没有证据证明某个项目同时实现三平台裸 Space、Flyfish 广泛格式、经过测量的 100 ms P95 和大文件低内存。

Flyfish 官方的 [QuickLook](https://github.com/flyfish-dev/quicklook) 已将 Win32、WebView2 与 Flyfish 组合；[Arcade Look](https://github.com/qa-p1/Arcade-look) 提供跨平台入口，早期最接近交互目标；[QL-Win QuickLook](https://github.com/QL-Win/QuickLook) 有成熟的 Windows 插件和系统集成。不同项目的格式数、缩略图数及 README 性能声明不能直接比较。

早期建议试验 Arcade Look + Flyfish。随后用户选择 Electron + TypeScript，QuickLook Fast 因而使用 Chromium 和 Flyfish，参考这些项目的平台入口、窗口管理和范围读取；没有把 Tauri 外壳直接嵌入。下方列出 12 个桌面项目及 Flyfish 的优势、缺点和借鉴状态。

零星或未被搜索收录的 GitHub 仓库无法穷尽；项目存在不等于经过构建、性能或真实桌面验证。Flyfish 登记扩展名不代表所有格式都能完整还原，部分运行时有独立许可证。

## 参考项目复盘与性能

原始调研包含 12 个桌面项目和 Flyfish 渲染引擎。以下是当时源码与文档的结论，不代表当前版本实测结果；代码许可应分别核对。

| 项目 | 优势 | 局限 | QuickLook Fast 借鉴 |
| --- | --- | --- | --- |
| [Arcade Look](https://github.com/qa-p1/Arcade-look) | 跨平台入口、常驻、范围读取、GNOME 协议 | Dolphin 菜单、Finder 组合键，专业格式有限 | 常驻、Range、GNOME 协议和平台边界。 |
| [LiteView](https://github.com/ameng1024/liteview) | Flyfish 资源打包与单实例入口 | 原方案有整文件 IPC 复制，空格集成有限 | 离线资源装配；使用文件服务减少数字数组复制。 |
| [Flyfish QuickLook](https://github.com/flyfish-dev/quicklook) | Win32 + WebView2 + Flyfish | Windows、有限入口和整读路径 | 原生入口与浏览器渲染分层。 |
| [GuoJikun QuickLook](https://github.com/GuoJikun/quicklook) | Windows 文件管理器接入案例 | 非跨平台，DOpus 未保证 | Windows 场景与测试清单。 |
| [OnePeek](https://github.com/Hyuzhe/OnePeek) | 桌面 Shell 和 Explorer 标签焦点 | Windows 专用 | 桌面选区与 Explorer 标签判断。 |
| [QuickPreview for Windows](https://github.com/kavabunga6/QuickPreview-Windows) | 专业格式和文件顺序案例 | 部分依赖 Windows 原生组件 | 格式与顺序验收样本。 |
| [rooq](https://github.com/asong56/rooq) | 小型钩子原型 | 格式和 PDF 页数有限 | 异步选区与钩子思路。 |
| [Dzurkel](https://github.com/EdinUser/dzurkel) | Linux 文件管理器与 Wayland 经验 | 桌面配置差异 | 大文本片段和平台接入测试。 |
| [Kglance](https://github.com/Mintori09/kglance) | KDE 服务菜单 | KDE 及快捷键配置相关 | Dolphin 菜单参考。 |
| [klook](https://github.com/RishonDev/klook) | Dolphin 选区跟随 | 完整裸 Space 路线依赖改版 Dolphin | 选区跟随交互参考。 |
| [Magnetar Peek](https://github.com/Magnetar-OS/peek) | Nautilus/COSMIC 方向 | 部分入口依赖上游改动 | 桌面差异与回退策略。 |
| [Vitrine](https://github.com/XBTDMT/vitrine) | macOS Quick Look 扩展及 UTType | 扩展宿主不是 Electron 窗口 | Finder 类型注册的后续方案。 |
| [Flyfish File Viewer](https://github.com/flyfish-dev/file-viewer) | Office、工程、媒体与数据格式广 | 支持级别、整读路径和独立许可各异 | 当前主渲染引擎。 |

借鉴指设计、公开协议和测试思路，不表示复制受 GPL/AGPL 约束的代码。[第三方许可](../THIRD_PARTY.md)。

[Octopus](https://github.com/AIDotNet/Octopus) 的更新模块提供检查中、已是最新、发现新版本和失败等状态，也针对便携版保留下载入口。本项目借鉴这些交互状态，使用 GitHub Releases 的正式版本信息并由用户手动下载；没有复制它的自动安装或签名清单逻辑。

本地文件服务支持 Range 与取消，ZIP/RAR 使用按需路径，大文本使用片段，但其他格式仍可能整体读取。以往 Node 合成文件与单次真实 ZIP Worker 测量只说明对应读取链路，不能推算 Electron 窗口响应、滚动 FPS 或完整进程树内存；后续应在三平台记录冷启动、P50/P95、有效内容首帧及峰值。
