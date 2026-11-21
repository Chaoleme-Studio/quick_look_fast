# 固定预览与再次按空格

状态：已按下列交互实现；macOS 和 Windows 的真实桌面窗口层级及焦点仍待验证。

## 交互

1. 图钉保留当前文件和窗口内容，准备一个活动窗口，以便继续预览。固定不自动启用系统置顶。
2. 空格打开新预览时，保留窗口不跟随选区；活动窗口显示新文件并尽量位于前方，新窗口在显示器工作区内适当错位。
3. 取消旧窗口固定只改变该窗口的图钉。若另一个活动窗口已显示，继续由它接收文件管理器的空格和选区；旧窗口独立保留至手动关闭。若没有其他活动预览，旧窗口恢复为活动窗口。
4. 置顶由独立按钮控制，默认关闭；已置顶的窗口可能遮住普通预览，这是系统窗口层级的行为。
5. 每个窗口拥有独立的文件令牌和目录会话；关闭独立窗口时释放其资源。活动窗口可隐藏并复用。

## 参考与验证

参考了 Windows 版 [QL-Win/QuickLook](https://github.com/QL-Win/QuickLook/tree/dada5c3bfa7e20e969783a45e8c3d1bc9892028d)：它将[阻止关闭与保持最前分开](https://github.com/QL-Win/QuickLook/blob/dada5c3bfa7e20e969783a45e8c3d1bc9892028d/QuickLook/ViewerWindow.xaml.cs#L72-L114)，并在保留当前窗口后[新建活动窗口](https://github.com/QL-Win/QuickLook/blob/dada5c3bfa7e20e969783a45e8c3d1bc9892028d/QuickLook/ViewWindowManager.cs#L100-L106)。本项目允许取消固定，具体规则并非照搬上游。

自动化测试模拟 macOS 和 Windows 的固定、取消固定、选区跟随、独立置顶和窗口清理；还需在 Finder、Windows Explorer、桌面和 DOpus 中实测实际焦点与窗口层级。
