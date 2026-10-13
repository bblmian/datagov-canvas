# Chrome Web Store Listing — 数据治理画图 DataGov Canvas

> Last Updated: 2026-10-13

Everything the Developer Dashboard asks for, ready to paste. Copy blocks inside ``` fences as
plain text — the store strips Markdown. Default listing language: 中文（简体）; second listing: English.

## Store Listing

**Extension Name** [REQUIRED] — comes from `public/_locales/*/messages.json` (`extName`), so the
store shows the localized name automatically:

- zh_CN: `数据治理画图 DataGov Canvas`
- en: `DataGov Canvas – Data Governance Diagrams`

**Short Description** [REQUIRED] — also from `_locales` (`extDescription`), ≤ 132 characters:

- zh_CN: `用 DBML 画数据治理图：ER 图、数据血缘和元数据。离线可用，中英双语，可导出 PNG、SVG、PDF 和 SQL。`
- en: `Draw data governance diagrams from DBML: ER diagrams, data lineage and metadata. Works offline; exports PNG, SVG, PDF and SQL.`

**Detailed Description** [REQUIRED] — 中文（默认）:

```
用 DBML 文本描述数据库结构，右侧实时画出关系图；也可以直接在图上点选、拖拽修改，改动会同步写回文本。

主要功能
• 左边写 DBML，右边实时生成 ER 图：表、字段、主键、外键、索引，一对一 / 一对多 / 多对多关系
• 数据治理：表分组、数据血缘（上下游依赖）、元数据、注释便签、示例数据，可按视图只显示部分表
• 图形化编辑：在属性面板里改表和字段，从字段拖线建立关系，拖到垃圾桶删除，随时撤销
• 三种显示模式：全部字段 / 仅键字段 / 仅表名
• 导入：粘贴或选择 PostgreSQL、MySQL、SQL Server、Oracle、Snowflake 建表语句，以及 Rails schema.rb 和 DBML 文件
• 导出：PNG、SVG 图片，矢量 PDF，DBML，PostgreSQL / MySQL / SQL Server / Oracle 建表语句，JSON
• 可以建多个关系图，自动保存在本机
• 中英双语界面，一键切换

使用方法
1. 点浏览器工具栏上的扩展图标，在新标签页打开编辑器
2. 在左侧编辑 DBML，或点「导入」粘贴已有的建表 SQL
3. 拖动表格调整布局；点击表格，在右侧面板里修改
4. 点「导出」保存图片、PDF 或 SQL

隐私
关系图只保存在你自己的浏览器里，不上传到任何服务器。不需要账号，不收集任何个人信息，没有统计、没有广告，断网也能用。

权限说明
• 存储：在本机保存你的关系图和界面设置
• 无限存储：关系图较大（表多、带示例数据）时，不受浏览器默认的存储容量上限限制

反馈与源码
问题和建议请到 https://github.com/bblmian/datagov-canvas/issues 提交，或发邮件到 benjaminfaxpaper01@gmail.com。
本扩展以 MIT 许可证开源，为独立开发，与 DBML 语言的维护方没有关联。

版本 0.1.0 — 首次发布
```

**Detailed Description** — English:

```
Describe your database in DBML text and see the diagram update live next to it. Or edit the diagram directly — every click and drag is written back into the text.

FEATURES
• DBML on the left, live ER diagram on the right: tables, columns, primary and foreign keys, indexes, one-to-one / one-to-many / many-to-many relationships
• Data governance: table groups, data lineage (upstream and downstream dependencies), metadata, sticky notes, sample records, and views that show only part of the diagram
• Visual editing: change tables and columns in the property panel, drag from a column to create a relationship, drop onto the trash can to delete, undo any time
• Three display modes: all columns / key columns only / table names only
• Import: paste or open CREATE TABLE statements from PostgreSQL, MySQL, SQL Server, Oracle and Snowflake, as well as Rails schema.rb and DBML files
• Export: PNG and SVG images, vector PDF, DBML, PostgreSQL / MySQL / SQL Server / Oracle DDL, JSON
• Keep as many diagrams as you like, saved automatically on your computer
• English and Chinese interface, switch with one click

HOW TO USE
1. Click the extension icon in the toolbar — the editor opens in a new tab
2. Write DBML on the left, or click Import and paste existing SQL
3. Drag tables to arrange them; click a table to edit it in the side panel
4. Click Export to save an image, a PDF or SQL

PRIVACY
Your diagrams stay in your own browser and are never uploaded anywhere. No account, no personal data collected, no analytics, no ads. Works offline.

PERMISSIONS
• Storage — saves your diagrams and settings on your computer
• Unlimited storage — lets large diagrams (many tables, sample records) grow past the browser's default storage limit

FEEDBACK AND SOURCE
Report issues at https://github.com/bblmian/datagov-canvas/issues or email benjaminfaxpaper01@gmail.com.
Open source under the MIT license. Independently developed; not affiliated with the maintainers of the DBML language.

Version 0.1.0 — first release
```

**Category** [REQUIRED]: Developer Tools（开发者工具）

**Single Purpose** [REQUIRED] (dashboard → Privacy tab; reviewers read it, users don't):

```
Draws and edits database and data-governance diagrams (ER diagrams, data lineage) from DBML text, entirely offline in a browser tab.
```

**Primary Language** [REQUIRED]: 中文（简体）; additional listing: English

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|-------|-----------|--------|----------|
| Store Icon [REQUIRED] | 128×128 PNG | 🟡 Exists; artwork fills 120/128 px, store guideline is 96×96 artwork + 16 px transparent margin (not a rejection reason, but it looks oversized next to other icons) | `public/icons/icon128.png` |
| Screenshot 1 [REQUIRED] | 1280×800 | ✅ Ready | `store-assets/<zh|en>/1-editor-and-diagram.png` |
| Screenshot 2 [RECOMMENDED] | 1280×800 | ✅ Ready | `store-assets/<zh|en>/2-lineage.png` |
| Screenshot 3 [RECOMMENDED] | 1280×800 | ✅ Ready | `store-assets/<zh|en>/3-property-panel.png` |
| Screenshot 4 | 1280×800 | ✅ Ready | `store-assets/<zh|en>/4-import-sql.png` |
| Small Promo Tile [RECOMMENDED] | 440×280 | ✅ Ready | `store-assets/<zh|en>/promo-small-440x280.png` |
| Marquee Promo Tile | 1400×560 | ✅ Ready | `store-assets/<zh|en>/promo-marquee-1400x560.png` |

### Screenshot Notes

Generated by `npm run build && npm run shots` (`scripts/store-shots.mjs`): the built extension in
Chrome for Testing, a seeded "sales warehouse" diagram (3 source tables → 3 warehouse tables → 2
marts, table groups per layer, lineage deps, metadata, a sticky note), captured at 2× and scaled
to the exact size. One set per listing language — upload `store-assets/zh/` to the 中文 listing and
`store-assets/en/` to the English one. Re-run after visible UI changes.

1. Editor and diagram side by side
2. Lineage across the three layers, key columns only, editor collapsed
3. Property panel open on `dwd.fact_order` (columns, relationships, dependencies)
4. Import dialog with pasted SQL

No dbdiagram.io UI, names or logos anywhere in the shots; no browser chrome or device mockups.

## Permissions Justification

| Permission | Type | Justification |
|------------|------|---------------|
| `storage` | permissions | Saves the user's diagrams (DBML text and table positions), the list of diagrams and UI settings (language, panel width) on the user's computer so work survives closing the tab. Nothing is synced or sent off the device. |
| `unlimitedStorage` | permissions | A diagram stores its full DBML text, every table's position and any sample records; users with many diagrams or large schemas exceed the 10 MB local storage quota, after which saving would silently fail and work would be lost. |

No `host_permissions`, no content scripts. The `tabs` permission is not needed: the toolbar button
opens or focuses the extension's own page only.

**Remote code** (dashboard asks): No — all code is bundled in the package; nothing is loaded from
a network at runtime.

## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** No

Diagrams and settings are stored only in the browser on the user's device (local extension storage)
and never transmitted. There are no network requests, analytics, crash reporting or third-party
services. The only outbound action is the "DBML syntax" button, which opens public documentation
in a new tab when the user clicks it.

| Data Type | Collected? | Transmitted Off-Device? | Purpose | Shared with Third Parties? |
|-----------|-----------|------------------------|---------|---------------------------|
| Personally identifiable info | No | No | — | No |
| Health info | No | No | — | No |
| Financial info | No | No | — | No |
| Authentication info | No | No | — | No |
| Personal communications | No | No | — | No |
| Location | No | No | — | No |
| Web history | No | No | — | No |
| User activity | No | No | — | No |
| Website content | No | No | — | No |

### Data Use Certification
- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

## Privacy Policy

**Privacy Policy URL** [REQUIRED]: `https://bblmian.github.io/datagov-canvas/privacy` — ⬜ not live
yet (repo not created). Source: `docs/privacy.md` (GitHub Pages from `/docs`); same text as below:

```
数据治理画图 DataGov Canvas 隐私政策 / Privacy Policy

最后更新 / Last updated: 2026-10-13

数据治理画图（DataGov Canvas）不收集、不上传、不出售任何个人数据。
你创建的关系图（DBML 文本、表格位置）和界面设置只保存在你自己电脑上的浏览器扩展存储中，不会发送到任何服务器。
本扩展不使用 Cookie、统计分析、广告或任何第三方服务，也不读取你访问的网页。
卸载扩展时，浏览器会一并删除这些数据；你也可以随时在扩展里删除单个关系图。
点击「DBML 语法」按钮会在新标签页打开公开的 DBML 文档网站，该网站的隐私政策由其运营方负责。
如果这些做法有变化，会更新本页并修改上面的日期。
联系方式：benjaminfaxpaper01@gmail.com

DataGov Canvas does not collect, upload or sell any personal data.
Your diagrams (DBML text, table positions) and settings are stored only in the browser's extension storage on your own computer and are never sent to any server.
The extension uses no cookies, analytics, ads or third-party services, and does not read the web pages you visit.
Uninstalling the extension deletes this data; you can also delete individual diagrams inside the extension at any time.
The "DBML syntax" button opens the public DBML documentation website in a new tab; that site's own privacy policy applies there.
If these practices change, this page and the date above will be updated.
Contact: benjaminfaxpaper01@gmail.com
```

## Distribution

**Visibility**: Public
**Regions**: All regions
**Pricing**: Free

## Developer Info

**Publisher Name** [REQUIRED]: bblmian (non-trader / individual)

**Contact Email** [REQUIRED]: benjaminfaxpaper01@gmail.com (shown publicly; Google sends review and policy notices here)

**Support URL** [RECOMMENDED]: https://github.com/bblmian/datagov-canvas/issues

**Homepage URL** [RECOMMENDED]: https://github.com/bblmian/datagov-canvas

## Version History

| Version | Date | Changes | Status |
|---------|------|---------|--------|
| 0.1.0 | — | First release | Draft |

## Review Notes

### Before the first submission (blocking)

- [x] English `extDescription` was 146 characters; the manifest limit is 132 and the upload would
      be refused. Shortened to 126 (2026-10-13).

- [x] **Third-party license notices.** `scripts/third-party-licenses.mjs` (a Vite plugin, also run
      in the worker build) writes `dist/THIRD_PARTY_LICENSES.txt`: 47 packages, including the
      libraries @dbml/core and @dbml/parse inline in their own builds (antlr4, lodash, luxon,
      parsimmon, pluralize, pathe). antlr4's npm package has no license file, so its upstream text
      is kept in `scripts/licenses/antlr4.txt`; the build fails if any package has no license text.
- [x] **Own license.** `LICENSE` (MIT, © 2026 bblmian), `"license": "MIT"`, package renamed to
      `datagov-canvas`.
- [x] **README / CLAUDE.md wording** no longer says the app copies dbdiagram.io; README states
      it is independent and not affiliated with the DBML maintainers.
- [x] Screenshots (zh + en) the 440×280 promo tiles and the 1400×560 marquee tiles — `npm run shots`.
- [x] Package: `npm run build && npm run package` → `datagov-canvas-<version>.zip` (contents of
      `dist/`, manifest at the root, no `.map` files; 0.1.0 is ~3 MB zipped).
- [x] Public GitHub repo https://github.com/bblmian/datagov-canvas (2026-10-13), Pages from
      `main` `/docs` serving the privacy policy.
- [ ] Developer account: one-time US$5 registration and 2-Step Verification on the Google account.

### Staying clear of dbdiagram.io / Holistics

- Patents: no patents assigned to Holistics Software Pte Ltd turned up in a search (2026-10-13).
  @dbml/core and @dbml/parse are Apache-2.0, which grants a patent license for whatever their
  contributors' patents cover in that code — that is the only Holistics code we use. The grant ends
  for anyone who sues over patents in the library, so never do that.
- Copyright: the editor, canvas, styles and icons are written from scratch; nothing is copied from
  dbdiagram.io's closed-source app (code, CSS, icons, sample diagrams, wording). Keep it that way.
- Trademarks: "dbdiagram", "dbdiagram.io", "dbdocs" and "Holistics" must not appear in the name,
  descriptions, screenshots or store keywords. "DBML" is used only to name the open language the
  extension reads. The help button links to the official DBML docs; that's a plain link.

### Known Issues / Limitations

- PDF export goes through Chrome's print dialog ("Save as PDF").
- Unpacked size is ~16 MB (~3 MB zipped), mostly the DBML parser with every SQL dialect; review may take a little longer.

### Rejection History

| Date | Reason | Fix Applied | Resubmitted |
|------|--------|-------------|-------------|
