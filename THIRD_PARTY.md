# 第三方组件与素材

QuickLook Fast 自有代码采用 [Apache-2.0](LICENSE)，但第三方依赖各自适用其许可证。[Flyfish File Viewer 3.3.4](https://github.com/flyfish-dev/file-viewer) 主项目为 Apache-2.0；离线资源中保留上游许可和 NOTICE。DWG/DWF/DWFX 运行时还包含 AGPL-3.0-only 组件及 GPL-3.0-only 的 LibreDWG 绑定；分发时必须同时遵守这些组件的许可证，具体许可与源码地址随 CAD 运行时提供。项目的 Apache-2.0 不会替代第三方许可证。

对 Flyfish 的本地构建修改：PPTX Worker 补丁见 [`patch-flyfish-pptx.cjs`](scripts/patch-flyfish-pptx.cjs)，图表换行补丁见 [`flyfish-pptx-chart-fix.cjs`](scripts/flyfish-pptx-chart-fix.cjs)，DOCX Worker 仅允许指定本地 JSZip 的协议适配见 [`patch-flyfish-docx.cjs`](scripts/patch-flyfish-docx.cjs)。

| 组件或参考 | 用途与许可信息 |
| --- | --- |
| Electron / Chromium | 桌面宿主及浏览器渲染；运行时附带许可证。 |
| [zip.js 2.25.0](https://github.com/gildas-lormeau/zip.js) | ZIP 解析及密码，BSD-3-Clause。 |
| [node-unrar-js 2.0.2](https://github.com/YuJianrong/node-unrar.js) | RAR 适配层 MIT；附带 UnRAR WASM 有独立许可，见 [全文](third-party/UnRAR-LICENSE.txt)。 |
| [officecrypto-tool 0.0.19](https://github.com/zurmokeeper/officecrypto-tool) | Office 密码解密，MIT。 |
| [exifr 7.1.3](https://github.com/MikeKovarik/exifr) | EXIF，MIT。 |
| [dbus-next 0.10.2](https://github.com/dbusjs/node-dbus-next) | Linux GNOME D-Bus，MIT；依赖的许可随包保留。 |
| [Arcade Look](https://github.com/qa-p1/Arcade-look) | Windows 入口设计参考，MIT 许可随包保留。 |
| [QL-Win QuickLook](https://github.com/QL-Win/QuickLook) | DOpus 协议研究参考，GPL-3.0-or-later；本项目独立实现消息请求，不打包其源码。 |

应用图标源图 `public/branding/icon-source.png` 由用户提供，本项目没有确认其独立授权；生成脚本仅裁切和缩放。公开发布前应确认素材的使用权。测试演示文件来源见 [`tests/fixtures/README.md`](tests/fixtures/README.md)。
