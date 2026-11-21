# 平台与文件管理器

## Directory Opus 与 QuickLook 接入

Windows 桥接进程使用低级键盘钩子识别 Space，并在文件列表上下文中读取选区。Explorer 和桌面走 Shell；Directory Opus 使用 `DOpus.ParentWindow` / `WM_COPYDATA` 请求 XML，消息窗口逐次创建，校验返回的 Lister 与文件路径。不可用时尝试 DOpusRT。

对照 QL-Win QuickLook 的 `WindowHelper.BringToFront`：普通预览在不激活的条件下短暂提升并恢复普通层级。QuickLook Fast 的 Windows 桥接对自身窗口使用同类 Win32 层级操作，图钉才保持置顶；系统焦点、管理员权限差异和真实 DOpus 桌面仍需验证。

DOpus 的 `listsel` 默认针对当前源标签。双栏快速点击后源状态可能滞后，因此先请求 `paths`，根据焦点或最近点击的文件列表匹配目标 Lister 中的可见标签，再指定标签请求选区；无法定位时回退源标签。快速点击后按 Space，后台最多等到点击后 70 ms，给选择状态时间更新。查询不会有意选用其他 Lister 的文件。

模拟测试覆盖 XML 安全、多个 Lister、同一窗口双栏源状态滞后、窗口消息、选择缓存与连续空格的部分状态。用户报告第二分栏目前能够预览；仍应在最新版本中复测两栏、多个窗口、快速点击及连续 Space。设置页“系统集成”显示最近识别状态。

若自动识别不可用，可在 DOpus 的 **Customize → Keys** 建立 Lister Hotkey，将 Space 指向以下命令并替换程序路径：

```text
"C:\QuickLook Fast\QuickLook Fast.exe" {filepath$}
```

同时检查 QuickShow、QuickLook、Peek 和其他快捷键的冲突。该备用入口能传路径，但不能保证方向键选区跟随。

协议参考：[DOpusRT 文件信息](https://docs.dopus.com/doku.php?id=reference:dopusrt_reference:retrieving_file_and_folder_information)、[可见栏与源状态](https://resource.dopus.com/t/how-to-get-the-current-destination-path-selected-item-via-dopusrt/44561)、[Lister/标签窗口句柄](https://resource.dopus.com/t/activate-the-directory-opus-under-the-mouse-cursor/42595/6)、[WM_COPYDATA](https://learn.microsoft.com/en-us/windows/win32/dataxchg/wm-copydata)。QL-Win QuickLook 的协议实现作为研究参考，本项目独立实现；许可见 [THIRD_PARTY](../THIRD_PARTY.md)。

## 文本预览与跨平台接入

### Octopus 参考

[Octopus](https://github.com/AIDotNet/Octopus) 的参考提交为 `aeb801581794376afbd18e62ff58fbe26cca0cd8`。其 [CodeSyntax.cs](https://github.com/AIDotNet/Octopus/blob/aeb801581794376afbd18e62ff58fbe26cca0cd8/src/Octopus.App/Files/CodeSyntax.cs) 使用 TextMate 语法，逐行维护状态；[CodeView.cs](https://github.com/AIDotNet/Octopus/blob/aeb801581794376afbd18e62ff58fbe26cca0cd8/src/Octopus.App/Files/CodeView.cs) 分开绘制行号和文本，并考虑可见区域。

QuickLook Fast 使用 Flyfish/highlight.js；超过 16 MiB 的常见文本读取 1 MiB 片段，仅生成可见行号。顶层可切换首尾；文件夹内只支持开头。Markdown 采用排版视图和左侧目录。语言及编码覆盖不等同于 Octopus，未复制其代码。

### macOS

支持 macOS 26 及以上的 Apple Silicon / arm64 包。在“设置 → 系统集成”中选择 Finder 和桌面的预览快捷键：

- **macOS 快速查看**将空格交给系统处理。
- **QuickLook Fast · ⌘⇧Space** 通过自动化读取 Finder 选区。首次在 Finder 中使用时允许应用控制 Finder。组合键注册失败会显示状态。
- **QuickLook Fast · Space** 是新安装的默认选项。授权辅助功能后，应用会自动在 Finder 和桌面接管空格。选中单个项目后按空格打开预览，再按一次收起。若 macOS 首次提示访问桌面资料夹，请允许 QuickLook Fast 读取桌面文件。

可在“系统设置 → 隐私与安全性 → 辅助功能”管理 QuickLook Fast 的权限。已有的快捷键选择会随应用重启恢复。切回“macOS 快速查看”或退出应用即可恢复系统处理。按 ↑ 或 ↓ 会跟随原 Finder 列表或桌面上的选区。可在“设置 → 常规”关闭方向键切换。固定的预览保持在当前文件。

Dock 和菜单栏图标可独立开关。默认隐藏 Dock、显示彩色菜单栏图标。两个图标都隐藏后，可以从 Spotlight 或 Finder 重新打开应用窗口，在窗口中按 ⌘Q 可以完全退出。分发包仅临时签名，登录项是否生效以 macOS 系统设置为准。

### Linux

GNOME Files 接入 `org.gnome.NautilusPreviewer` D-Bus，支持已实现的 `ShowFile`、关闭和方向事件，不抢占已运行的同名服务。Wayland 激活令牌尚未完整使用。KDE Plasma 的 Dolphin 使用用户级服务菜单传递文件或文件夹路径，目标覆盖 Wayland 与 X11；Dolphin 26.04 起可给服务菜单动作配置快捷键，旧版本仍可点击菜单。Nemo 也有菜单入口。其他文件管理器可使用路径参数，但不保证方向键跟随。

Linux 便携目录运行 `./install-integration.sh --gnome` 可安装 GNOME 服务与菜单；省略 `--gnome` 只安装菜单。不会覆盖已有同名用户级文件。可能需要重启文件管理器；X11、GNOME Wayland 与 KDE Wayland 都需要实际测试。

### 从其他预览工具迁移

QL-Win QuickLook、PowerToys Peek、旧版 SlowLook 和 QuickLook Fast 都可能使用 Space 或相关快捷键。它们可以共存，但同时运行可能出现重复弹窗、按键被抢占或方向键行为不一致。切换前先退出旧程序托盘，并在旧程序中关闭其开机启动，再启用新程序。旧插件、配置和数据不会自动迁移；本项目不会卸载旧程序。

旧版 SlowLook 的用户数据、Windows 开机项以及 `~/.local/share/kio/servicemenus/slowlook.desktop`、`~/.local/share/nemo/actions/slowlook.nemo_action` 不会自动删除。GNOME 的 `org.gnome.NautilusPreviewer` 是共享服务名，如果旧的用户级服务文件已存在，安装器不会覆盖；确认不再使用后，可由用户自行处理旧文件并重新安装。更名后内部协议 `slowlook://` 和部分开发标识保留，用来降低兼容改动，它们不是显示名称。

参考：[GNOME Sushi](https://github.com/GNOME/sushi)、[KDE 服务菜单](https://develop.kde.org/docs/apps/dolphin/service-menus/)、[Dolphin 26.04](https://blogs.kde.org/2026/05/03/dolphin-26.04-release/)。
