# 平台与文件管理器

## Directory Opus 与 QuickLook 接入

Windows 桥接进程使用低级键盘钩子识别 Space，并在文件列表上下文中读取选区。Explorer 和桌面走 Shell；Directory Opus 使用 `DOpus.ParentWindow` / `WM_COPYDATA` 请求 XML，消息窗口逐次创建，校验返回的 Lister 与文件路径。不可用时尝试 DOpusRT。

对照 QL-Win QuickLook 的 `WindowHelper.BringToFront`：普通预览在不激活的条件下短暂提升并恢复普通层级。QuickLook Fast 的 Windows 桥接对自身窗口使用同类 Win32 层级操作；固定和置顶分别控制，只有用户单独开启置顶的窗口保持置顶。系统焦点、管理员权限差异和真实 DOpus 桌面仍需验证。

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

#### 下载与安装

1. 在 Linux 终端运行 `uname -m` 确认架构：`x86_64` 下载 Release 的 `linux-x64.tar.gz`；`aarch64` 下载 `linux-arm64.tar.gz`。这指的是 **Linux 系统架构**，不是宿主 Mac 的架构。
2. 从 [GitHub Releases](https://github.com/Chaoleme-Studio/quick_look_fast/releases) 下载归档，将整个 `V1` 目录解压到固定位置。`V1` 是包内目录名，不是软件版本号。不要只复制可执行文件，它依赖同目录中的其他文件。
3. 在解压出的 `V1` 目录运行 `./install-integration.sh`，为当前用户安装 Dolphin 和 Nemo 的右键菜单。GNOME 用户运行 `./install-integration.sh --gnome`，还会安装 GNOME Files 预览服务。脚本使用包内的 Electron 运行时，不需要单独安装 Node.js 或使用管理员权限。

例如，已将 1.0.0 ARM64 归档下载到 `~/Downloads`，可在终端运行：

```sh
mkdir -p "$HOME/Applications"
mkdir "$HOME/Applications/QuickLook-Fast-1.0.0" &&
  tar -xzf "$HOME/Downloads/QuickLook-Fast-v1.0.0-linux-arm64.tar.gz" -C "$HOME/Applications/QuickLook-Fast-1.0.0" &&
  "$HOME/Applications/QuickLook-Fast-1.0.0/V1/install-integration.sh"
```

该示例只在目标目录不存在时继续；其他版本或架构请替换归档与目录名。菜单中保存的是程序的**绝对路径**，安装后不要移动或删除该目录。若要搬迁，先确认并移除自己安装的旧菜单，再从新位置重新运行安装脚本；安装器不会覆盖已存在的同名文件。更新菜单路径后重新打开 Dolphin，让它读取新菜单。

#### Dolphin 中设置空格预览

Dolphin 使用服务菜单把所选文件或文件夹交给 QuickLook Fast。安装菜单后，右键文件，应该能看到 **Preview with QuickLook Fast / QuickLook Fast 预览**；菜单未显示时可重新打开 Dolphin。这个入口本身还不会自动把 Space 设为快捷键。安装器会赋予 Dolphin 服务菜单执行权限；如果手动复制或编辑后出现“无权执行此文件”，先确认菜单内容属于 QuickLook Fast，再为该菜单文件添加当前用户的执行权限。

1. 运行 `dolphin --version` 查看 **Dolphin 的版本**。Dolphin 26.04 及以上支持为服务菜单动作配置快捷键；这不是 Ubuntu 或 Fedora 的版本号。旧版可使用右键菜单。
2. 打开 Dolphin 的 **Settings → Configure Keyboard Shortcuts…**（设置 → 配置键盘快捷键）；菜单栏隐藏时可先按 `Ctrl+M` 显示。
3. 搜索 **Select Files and Folders**（选择文件和文件夹）。Dolphin 通常将 Space 用于切换选择模式。若它占用了 Space，选中该操作并清除或改绑这个快捷键；也可在后续提示冲突时选择重新分配。
4. 搜索 **Preview with QuickLook Fast** 或 **QuickLook Fast 预览**，在 **Context Menu Actions**（右键菜单动作）下选中它，选择自定义快捷键，点击快捷键录入按钮并按 Space，最后点击 **OK / 确定**保存。若 Space 已用于其他操作，按需先解除冲突。
5. 在 Dolphin 文件列表中选中一个文件或文件夹并按 Space，再按 Space 或 Esc 收起。即使程序尚未运行，菜单动作也会启动它；关闭预览通常只是隐藏窗口，要完全退出请使用系统托盘的“退出”。

这个快捷键属于 Dolphin，并会替代 Dolphin 原来的 Space 选择模式；其他 Dolphin 快捷键不受影响。当前不能在预览窗口中用方向键跟随 Dolphin 切换文件；先关闭预览，在 Dolphin 中选择另一个文件，再按 Space。

已在 **Fedora 45 ARM64、KDE Plasma Wayland、Dolphin 26.08.2** 虚拟机上验证文本文件的空格打开、关闭、切换选中文件和程序未驻留时的启动；Fedora 44、其他版本和其他文件类型未因此获得完整验证。

#### KDE Plasma 桌面空格预览（实验性）

Plasma 桌面和 Dolphin 的快捷键分别配置。**1.0.0 发布包提供可选的实验性桌面组件**；0.3.0 下载包不包含此组件。在 Plasma 6 的图形桌面会话中，进入新的便携目录运行：

```sh
./install-integration.sh --plasma-desktop
```

脚本会安装 Dolphin/Nemo 菜单，并为当前活动的 Folder View 桌面安装 QuickLook Fast 组件。选中单个本地文件或文件夹后按 Space 打开，再按 Space 或 Esc 收起。该组件只针对桌面文件视图，不注册全局空格快捷键；在其他应用输入和桌面重命名不应受影响。新增显示器或切换到未配置的活动后，可以在对应活动中重跑安装命令。

在 Fedora 45 ARM64、Plasma 6.8.1 Wayland 上已验证桌面文本文件的空格打开、关闭、中文及特殊字符文件名，以及重命名和 Dolphin 输入框中的空格。该组件使用 Plasma 的内部接口，其他版本（包括 Fedora 44）的兼容性仍需实测；所需 Plasma 组件不可用时不会接管空格。日志可用 `journalctl --user -b | grep 'QuickLook Fast'` 检查。

不再使用时，在原便携目录运行：

```sh
./install-integration.sh --remove-plasma-desktop
```

该命令只移除 QuickLook Fast 的桌面组件，不会清除 Dolphin 快捷键或 GNOME 接入。组件记录了程序绝对路径；移动或升级便携目录之前，先用旧目录的脚本移除组件，再从新目录重新安装。若组件文件被手动修改，卸载脚本会保留文件并提示检查。更新桌面组件的 QML 代码或从早期实验版迁移后，需要注销并重新登录以刷新 Plasma 缓存；仅切换程序目录时，采用当前组件重新安装后无需刷新缓存。Dolphin/Nemo 菜单的程序路径仍需按上面的安装说明分别更新。

#### 恢复快捷键与卸载

恢复 Dolphin 默认 Space：在同一快捷键设置中先清除 **Preview with QuickLook Fast** 的 Space，再找到 **Select Files and Folders** 并恢复其默认快捷键；也可以为这两个操作自行选择其他按键。不要使用“Defaults / 默认值”重置全部操作，除非你确实想清除 Dolphin 的其他自定义快捷键。

默认情况下菜单文件为 `~/.local/share/kio/servicemenus/quicklook-fast.desktop` 和 `~/.local/share/nemo/actions/quicklook-fast.nemo_action`；若设置了 `XDG_DATA_HOME`，则位于该目录下对应子目录。要移除接入，先确认这些文件属于本次安装，再删除它们并重新打开文件管理器。GNOME 的 `dbus-1/services/org.gnome.NautilusPreviewer.service` 名称可能被其他预览程序共用；只有在检查内容并确认属于 QuickLook Fast 后才能删除。最后可删除解压的便携目录。

进阶排查：Dolphin 的自定义快捷键通常写在 `~/.local/share/kxmlgui5/dolphin/dolphinui.rc`。本次 Fedora 虚拟机在该文件中为 `servicemenu_quicklook-fast.desktop::quicklookFastPreview` 配置了 `Space`，并清除了 `toggle_selection_mode` 原有的 Space。该文件还可能包含其他个人设置；通常应通过快捷键设置界面修改，不要用精简文件覆盖或直接删除整份配置。

#### GNOME 与其他文件管理器

GNOME Files 接入 `org.gnome.NautilusPreviewer` D-Bus，支持已实现的 `ShowFile`、关闭和方向事件，不抢占已运行的同名服务。安装器不会覆盖已有的同名用户级服务文件；如果已有其他预览程序，先检查服务归属及是否仍在运行。必要时重新打开 Files。Ubuntu GNOME 虚拟桌面已做过预览测试；Wayland 激活令牌尚未完整使用，其他 GNOME 版本及 X11/Wayland 组合仍需分别验证。

Nemo 使用菜单入口；其他文件管理器可用程序完整路径加文件参数打开预览，但不保证快捷键或方向键跟随。快捷键只在相应文件管理器的作用域内生效。

### 从其他预览工具迁移

QL-Win QuickLook、PowerToys Peek、旧版 SlowLook 和 QuickLook Fast 都可能使用 Space 或相关快捷键。它们可以共存，但同时运行可能出现重复弹窗、按键被抢占或方向键行为不一致。切换前先退出旧程序托盘，并在旧程序中关闭其开机启动，再启用新程序。旧插件、配置和数据不会自动迁移；本项目不会卸载旧程序。

旧版 SlowLook 的用户数据、Windows 开机项以及 `~/.local/share/kio/servicemenus/slowlook.desktop`、`~/.local/share/nemo/actions/slowlook.nemo_action` 不会自动删除。GNOME 的 `org.gnome.NautilusPreviewer` 是共享服务名，如果旧的用户级服务文件已存在，安装器不会覆盖；确认不再使用后，可由用户自行处理旧文件并重新安装。更名后内部协议 `slowlook://` 和部分开发标识保留，用来降低兼容改动，它们不是显示名称。

参考：[GNOME Sushi](https://github.com/GNOME/sushi)、[KDE 服务菜单](https://develop.kde.org/docs/apps/dolphin/service-menus/)、[Dolphin 26.04](https://blogs.kde.org/2026/05/03/dolphin-26.04-release/)。
