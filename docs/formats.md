# 可预览文件格式清单

本文列出 QuickLook Fast 0.3.0 当前接入的扩展名，按用途分类。扩展名表示程序会尝试使用对应预览链路，**不等于所有文件、特性或操作系统都已逐一验证**。格式还原程度、密码支持、字体和外部资源会因文件而异。

当前接入的 Flyfish 3.3.4 渲染器中，266 个扩展名进入内容或结构预览链路；程序另外提供 `.m4v`、`.mov`、`.ogv` 的浏览器播放入口。音视频能否播放还取决于实际编码。下表标注“结构预览”的格式可能只显示部分页面、图层、元数据或对象。

<!-- formats:content:start -->

| 分类 | 文件类型 | 扩展名 | 预览方式与边界 |
| --- | --- | --- | --- |
| 文档 | Word OpenXML | `.docx` `.docm` `.dotx` `.dotm` | 文档内容与分页预览；复杂排版可能与 Word 不同。 |
| 文档 | 旧版 Word | `.doc` `.dot` | 结构化预览；旧格式的复杂布局支持有限。 |
| 文档 | PowerPoint OpenXML | `.pptx` `.pptm` `.potx` `.potm` `.ppsx` `.ppsm` | 幻灯片预览；动画、字体和复杂图表可能不同。 |
| 文档 | 旧版 PowerPoint | `.ppt` `.pot` | 结构化预览；不等同于新版 PPTX 渲染。 |
| 文档 | 开放文档与富文本 | `.rtf` `.odt` `.odp` | 结构化预览，复杂样式可能简化。 |
| 文档 | 其他文字处理 | `.wpd` `.wp` `.wp5` `.wp6` `.hwp` `.hwpx` | 结构化预览，复杂页面和嵌入对象可能简化。 |
| 表格 | 工作簿与数据表 | `.xlsx` `.xltx` `.xlsm` `.xlsb` `.xls` `.xlt` `.xla` `.xlam` `.xltm` `.csv` `.tsv` `.ods` `.fods` `.dbf` | 工作表或表格预览；公式、宏和复杂样式不保证完整。 |
| 文档 | PDF、OFD 与排版 | `.pdf` `.ofd` `.typ` `.typst` | PDF 使用分页预览；其他格式的还原效果取决于内容。 |
| 文档 | Apple iWork | `.pages` `.numbers` `.key` | 依赖文件内部可用的页面或结构；不同版本可能有差异。 |
| 电子书 | 电子书和帮助文档 | `.epub` `.fb2` `.umd` `.chm` | 阅读或结构预览；受保护内容及部分交互可能不支持。 |
| 图片 | 常见图片 | `.gif` `.jpg` `.jpeg` `.bmp` `.tiff` `.tif` `.png` `.svg` `.webp` `.avif` `.ico` `.heic` `.heif` `.jxl` | 显示图像；解码、动画与多帧支持取决于格式。 |
| 音频 | 音乐和音频 | `.mp3` `.mpeg` `.wav` `.ogg` `.oga` `.opus` `.m4a` `.aac` `.flac` `.weba` `.midi` `.mid` | 播放与音频预览；编码和波形效果依赖实际文件。 |
| 视频 | 视频和流媒体 | `.mp4` `.webm` `.m3u8` `.m4v` `.mov` `.ogv` | 播放入口；编码或受限的外部流地址可能无法播放。 |
| 三维 | 网格与场景 | `.glb` `.gltf` `.obj` `.stl` `.ply` `.fbx` `.dae` `.3ds` `.3mf` `.amf` `.usd` `.usda` `.usdc` `.usdz` `.kmz` | 三维模型预览；外部材质、纹理及动画支持因文件而异。 |
| 三维 | 工程模型与点云 | `.step` `.stp` `.iges` `.igs` `.ifc` `.3dm` `.brep` `.pcd` `.wrl` `.vrml` `.xyz` `.vtk` `.vtp` | 结构化或三维预览；复杂模型可能耗时或不完整。 |
| 工程 | CAD 与固定版式 | `.dxf` `.dwg` `.dwf` `.dwfx` `.xps` | CAD 图纸或固定版式预览；版本及图层支持因文件而异。 |
| 工程 | 电子设计 | `.olb` `.dra` `.gds` `.oas` `.oasis` | 图形或结构预览；不保证全部工程语义。 |
| 地图 | 地理数据 | `.geojson` `.kml` `.gpx` `.shp` | 地理数据预览；地图底图或关联文件可能不可用。 |
| 图表 | 流程图与思维导图 | `.excalidraw` `.drawio` `.dio` `.mermaid` `.mmd` `.plantuml` `.puml` `.xmind` | 图形或结构预览；外部资源和扩展语法可能受限。 |
| 设计 | Photoshop / Illustrator | `.psd` `.psb` `.pdd` `.psdt` `.ai` `.ait` `.eps` `.ps` | 图像、画板或结构预览；效果、图层和字体可能不完整。 |
| 设计 | Adobe 设计文档 | `.idml` `.icml` `.idms` `.inx` `.fla` `.xfl` `.xd` `.indd` `.indt` | 页面、内嵌预览或结构信息；部分格式不能完整还原。 |
| 设计 | 色板和资源 | `.ase` `.aco` `.abr` `.csh` `.pat` `.grd` `.asl` | 色板或资源结构预览。 |
| 字体和数据 | 字体与数据资产 | `.ttf` `.otf` `.woff` `.woff2` `.sqlite` `.wasm` `.parquet` `.avro` `.webarchive` `.hex` | 字体、结构或数据检查；不执行文件中的程序。 |
| 代码和文本 | 文本及配置 | `.txt` `.lrc` `.json` `.jsonc` `.json5` `.xml` `.yaml` `.yml` `.ini` `.toml` `.log` `.http` | 文本、高亮或结构预览；大文本可能只读取片段。 |
| 代码和文本 | Web 与脚本 | `.js` `.mjs` `.cjs` `.css` `.html` `.htm` `.jsx` `.ts` `.tsx` `.vue` `.react` `.sh` `.bash` `.php` `.py` `.rb` | 代码高亮；HTML 使用隔离预览，外部资源可能受限。 |
| 代码和文本 | 编程与标记 | `.java` `.sql` `.go` `.rs` `.c` `.cpp` `.cc` `.h` `.hpp` `.cs` `.diff` `.patch` `.bundle` `.bdl` `.ipynb` `.proto` `.hcl` `.tex` `.gv` `.swift` `.kt` `.md` `.markdown` | 文本、代码或 Markdown 预览；不执行代码。 |
| 压缩包 | ZIP / RAR 与其他归档 | `.zip` `.zipx` `.7z` `.rar` `.tar` `.gz` `.gzip` `.tgz` `.bz2` `.bzip2` `.tbz` `.tbz2` `.xz` `.txz` `.lzma` `.zst` `.tzst` `.cab` `.ar` `.cpio` `.iso` `.xar` `.lha` `.lzh` | 目录或条目预览；压缩方式、分卷和密码支持存在差异。 |
| 压缩包 | 软件包与漫画包 | `.jar` `.war` `.ear` `.apk` `.cbz` `.cbr` | 按归档结构查看，不安装或运行程序。 |
| 邮件 | 邮件和邮箱 | `.eml` `.msg` `.mbox` | 邮件内容与结构预览，外部资源可能受限。 |
| 安全 | 签名和加密容器 | `.p7m` `.p7s` `.p7c` `.p7b` `.pkcs7` `.cms` `.cmsc` `.tsd` `.tst` `.tsq` `.tsr` `.asics` `.scs` `.asice` `.sce` `.ers` `.asc` `.sig` `.pgp` `.gpg` `.jws` | 检查签名或容器结构；不代表能解密或验证所有证书链。 |

<!-- formats:content:end -->

## 仅检查信息或按文本回退

`.bin`、`.elf`、`.exe`、`.dll`、`.class`、`.macho` 会先检查文件头：明显的二进制内容显示文件信息与文件头，不执行程序；可识别为文本时按文本查看。未知扩展名也会采用类似的文本检查，故例如 `.srt` 可以作为普通文本查看，但不保证被识别为专用字幕播放器。

Flyfish 的总目录还列有 `.bpmn`、`.dcm`、`.dicom`，但当前程序没有接入这些格式对应的内容渲染器，不能算作已支持的专用预览。`.lnk` 和 `.url` 显示快捷方式信息，不执行目标。

常见密码加密的 DOCX/XLSX/PPTX 支持输入密码；ZIP/RAR 的常见密码路径单独处理。加密、输入大小、外部资源及其他限制见[兼容性说明](compatibility.md)和[使用指南](user-guide.md)。
