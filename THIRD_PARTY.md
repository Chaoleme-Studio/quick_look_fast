# 第三方组件、素材与许可证

本文记录 QuickLook Fast 0.2.0 的主要第三方来源、用途、许可位置及本项目修改。项目自有代码采用 [Apache-2.0](LICENSE)；依赖及其资源继续适用各自许可证。版本以 [pnpm-lock.yaml](pnpm-lock.yaml) 为准，表格不能替代随包附带的完整许可、版权声明和对应源码说明。

## 运行时直接依赖

| 组件及版本 | 在本项目中的用途 | 声明的许可和来源 |
| --- | --- | --- |
| [Electron 45.3.4](https://github.com/electron/electron) | 桌面宿主，包含 Chromium 与 Node.js。 | Electron 为 MIT；Chromium 和其他捆绑组件各有许可。便携目录根部附 `LICENSE`、`LICENSES.chromium.html`。 |
| [Flyfish File Viewer 3.3.4](https://github.com/flyfish-dev/file-viewer) | 文件格式注册、渲染器和离线资源；包括 `@file-viewer/core`、`web-full`、`renderer-binary`、`renderer-design`、`renderer-signature`。 | npm 包声明 Apache-2.0；随附的 CAD、字体、WASM 及其他资源有独立许可，见下文。 |
| [zip.js 2.25.0](https://github.com/gildas-lormeau/zip.js) | ZIP 目录、按需解压和常见密码。 | BSD-3-Clause。 |
| [node-unrar-js 2.0.2](https://github.com/YuJianrong/node-unrar.js) | RAR 目录和条目读取。 | JavaScript 包声明 MIT；内含 UnRAR 的许可另见 [UnRAR 原文](docs/licenses/UnRAR-LICENSE.txt)，其中限制用其源码重建 RAR 压缩算法。 |
| [officecrypto-tool 0.0.19](https://github.com/zurmokeeper/officecrypto-tool) | 常见加密 Office 文档解密。 | MIT。 |
| [exifr 7.1.3](https://github.com/MikeKovarik/exifr) | 读取照片的部分 EXIF。 | MIT。 |
| [mime-types 3.0.2](https://github.com/jshttp/mime-types) | 本机文件服务的 MIME 类型。 | MIT；数据依赖 `mime-db`。 |
| [dbus-next 0.10.2](https://github.com/dbusjs/node-dbus-next) | Linux GNOME Files 预览服务。 | MIT，仅 Linux 便携包复制其 Node 运行依赖。 |

转译、依赖解析和截图测试还使用 Vite 8.0.0（MIT）、TypeScript 5.9.3（Apache-2.0）、Happy DOM 21.0.4（MIT）、JSZip 3.10.2（MIT 或 GPL-3.0-or-later）、`@file-viewer/vite-plugin` 3.3.4（Apache-2.0）及类型声明等开发依赖。具体依赖树和锁定版本见 [package.json](package.json) 与 [pnpm-lock.yaml](pnpm-lock.yaml)；被 Flyfish 离线资源使用的其他 JSZip 等代码仍以其随附声明为准。

## Flyfish 离线资源及特殊许可

Flyfish Full 包包含的字体、PDF、文档、CAD、设计及 WebAssembly 资源不是统一按 Apache-2.0 授权。构建后完整清单位于 `build/dist/file-viewer/THIRD_PARTY_LICENSES.txt` 和 `THIRD_PARTY_LICENSES.assets.json`；便携包对应位置是 `resources/app/build/dist/file-viewer/`（macOS 位于 `.app/Contents/Resources/app/build/dist/file-viewer/`）。各 `vendor/` 和 `wasm/` 子目录还保留组件自己的许可证和 NOTICE。

特别需要检查：

| 资源 | 许可及原文位置 |
| --- | --- |
| CAD 渲染器 `@flyfish-dev/cad-viewer` 0.8.3、`dwf-viewer` 0.6.7 | AGPL-3.0-only；离线资源 `wasm/cad/0.8.3/` 中有 `LICENSE`、`NOTICE`、`CORRESPONDING_SOURCE_NOTICE.txt`。 |
| `@mlightcad/libredwg-web` 0.7.9 | GPL-3.0-only；对应源码与声明列在同一 CAD 来源文件中。 |
| OCCT 模型导入运行时 | 含 LGPL 及例外条款，详见 `wasm/model/` 中的许可证、例外与源码说明。 |
| PDF、字体、设计及其他资源 | 依组件分别适用许可；查看相应 `vendor/`、`wasm/` 内原文以及 Flyfish 总清单。 |

上游 CAD 对应源码声明给出了以下固定源码快照和校验值，分发者应保留原始声明并核对自身分发方式的义务：

| 源码 | 固定快照 | SHA-256 |
| --- | --- | --- |
| CAD viewer 0.8.3 | [源码归档](https://codeload.github.com/flyfish-dev/cad-viewer/tar.gz/6366d2f7b1013cd5c300008c3c3fbf017ca9aace) | `65d00f07230553734262d671abf45be94d83d3068318c0f25f8665494ec82bcb` |
| DWF viewer 0.6.7 | [源码归档](https://codeload.github.com/flyfish-dev/dwf-viewer/tar.gz/72783571e2cd744862d8eb32f7d3455906c76226) | `d246d61b914475412fdc33ea250646710c4a3431bfecad9c9a7700602923afb1` |
| LibreDWG Web 0.7.9 | [源码归档](https://codeload.github.com/mlightcad/libredwg-web/tar.gz/b70b5573a6bf2345e5fb10f2adff7fb74a8123c5) | `af350d628535a2842262af5b49d50568b6dae62854667e13bb9f161b26c00431` |
| File Viewer 3.3.4 CAD 集成 | [源码归档](https://codeload.github.com/flyfish-dev/file-viewer/tar.gz/a593ecd37fb14eb33eac91a5ac372c0e4f4629a8) | `f1bc0b81f57d027a36c78d4b763e64e50aa2e0837f6195615aa1ca216b754503` |

上游声明指出 `0.8.0` 等兼容路径实际指向相同的 0.8.3 运行时。此表用于定位材料，不代表已经完成所有发布合规核验。

## 本项目对 Flyfish 的修改

本项目固定使用 3.3.4，并在构建时应用以下补丁；脚本是修改的可检查来源，分发的编译 Worker 包含修改提示。

| 修改 | 源码位置 |
| --- | --- |
| PPTX 分组文字、竖排、形状几何、渐变、箭头、渐进样式及图表轴和颜色解析 | [patch-flyfish-pptx.cjs](patch/patch-flyfish-pptx.cjs) |
| PPTX 图表标签、轴顺序、刻度密度与数据标签位置 | [flyfish-pptx-chart-fix.cjs](patch/flyfish-pptx-chart-fix.cjs) |
| DOCX Worker 对本地 JSZip 资源的协议校验 | [patch-flyfish-docx.cjs](patch/patch-flyfish-docx.cjs) |
| DOCX 将渲染器识别的标题层级提供给文档导航 | [flyfish-docx-outline.cjs](patch/flyfish-docx-outline.cjs) |
| Excel 默认显示比例、行高、合并单元格和 Worker 行高处理 | [flyfish-xlsx-zoom-fix.cjs](patch/flyfish-xlsx-zoom-fix.cjs)、[flyfish-xlsx-row-fix.cjs](patch/flyfish-xlsx-row-fix.cjs)、[patch-flyfish-xlsx.cjs](patch/patch-flyfish-xlsx.cjs) |

## 参考项目与素材

| 来源 | 使用范围 | 许可或状态 |
| --- | --- | --- |
| [Arcade Look](https://github.com/qa-p1/Arcade-look) | 平台入口和交互设计参考。 | MIT，保留[许可原文](docs/licenses/Arcade-Look-LICENSE)。 |
| [QL-Win QuickLook](https://github.com/QL-Win/QuickLook) | 研究 Directory Opus 协议；本项目独立实现消息请求。 | GPL-3.0-or-later；未将该项目源码作为依赖打包。 |
| [Octopus](https://github.com/AIDotNet/Octopus) 及其他研究项目 | 调研交互、文本预览及平台差异。 | 各项目许可见其上游；用途与参考结论见[参考项目记录](docs/references.md)。 |
| 应用图标 `public/branding/icon-source.png` | 用户提供的图像，脚本裁切并生成应用图标。 | 独立授权尚未确认，公开发布前需要确认使用权。 |
| 测试文件及截图 | 自动测试和说明文档。 | 来源见[测试样本说明](tests/fixtures/README.md)及[截图说明](docs/releasing.md#重建文档截图)。 |

## 随包检查

便携包内 `resources/app/third-party-licenses/` 收集安装依赖中可识别的 LICENSE、NOTICE 等文件，可能包含仅构建或测试使用的依赖；它不是完整的软件物料清单。Flyfish 资源许可保留在其 `file-viewer/` 目录。发布前应核对实际包含的文件、许可证原文、源码声明、补丁和图标授权，不应只复制本文件代替原始许可。
