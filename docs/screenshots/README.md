# 截图生成

在能正常启动 Electron 的桌面，从项目根目录运行：

```sh
npm ci
npm run build
npm run screenshots
```

脚本将真实 Electron 渲染窗口捕获为 `welcome.png`、`settings.png`、`folder.png`、`pdf.png` 和 `pptx.png`，保存在此目录，并只更新 README 的截图标记区域。生成后请检查画面是否符合预期。该区域使用：

```md
![文件夹预览](docs/screenshots/folder.png)
![PDF 预览](docs/screenshots/pdf.png)
![PPTX 预览](docs/screenshots/pptx.png)
![设置](docs/screenshots/settings.png)
```

文件夹使用明确标注为演示的 D: 合成目录及合成文本；PDF 由脚本生成；PPTX 来自 `tests/fixtures/office-sample.pptx` 的公开样本。脚本不枚举真实 D 盘、不读取 Job 文件。截图目录的应用图标来自用户提供的图片。

本机 Electron 因 AppContainer 目录 ACL 被拒；仓库中的欢迎页、设置、文件夹和 PDF 截图来自 GitHub Windows 构建的实际 Electron 窗口，均使用上述合成或公开样本。PPTX 截图的时序修复后仍需检查生成结果；不得把测试 DOM 或加载画面当成最终预览截图。
