# 数据治理画图 DataGov Canvas（Chrome 扩展）

一个离线运行的 Chrome 扩展：左边写 [DBML](https://dbml.dbdiagram.io/docs)（一种开源的数据库结构描述语言），右边实时生成 ER 图、数据血缘和元数据图，也可以直接在图上编辑。不需要账号，数据只存在本机。

本项目独立开发，与 DBML 语言的维护方没有关联。DBML 的解析、SQL 导入导出用的是开源库 `@dbml/core` 和 `@dbml/parse`（Apache-2.0）。

## 功能

- DBML 编辑器：语法高亮、自动补全（关键字、表名、`表.字段`）、错误下划线，底部有错误列表，点一下就跳到出错的行
- 关系图：表头颜色（`headercolor`）、主键（包括联合主键）、FK、非空标记；关系连到具体字段上，两端画鱼尾纹（crow's foot）表示基数
- 鼠标悬停字段时，会高亮它的关系，并显示类型、约束、默认值、注释、枚举值
- 支持 TableGroup 分组框（拖动分组框会带着组里的表一起移动），也支持 `Note` 便签
- 拖动表格调整布局，位置会自动保存；可以一键自动排列；可以缩放、适应屏幕、开关小地图
- 显示模式：全部字段 / 仅键字段 / 仅表名
- 点击图上的表，编辑器会定位到这张表的定义
- 多个关系图：新建、重命名、复制、删除，都存在本地 `chrome.storage`
- 导入：PostgreSQL、MySQL、SQL Server、Oracle、Snowflake、Rails schema.rb、DBML 文件
- 导出：PNG、SVG、PDF、DBML、PostgreSQL、MySQL、SQL Server、Oracle、JSON
- 界面支持中文和英文，右上角一键切换（默认跟随浏览器语言）

## 安装（开发版）

```bash
npm install
npm run build
```

打开 `chrome://extensions`，开启「开发者模式」，点「加载已解压的扩展程序」，选中 `dist/` 目录。之后点工具栏上的图标，就会在新标签页里打开编辑器；如果已经开着，会直接切到那个标签页。

## 开发

```bash
npm run dev        # 以普通网页方式运行（存储自动改用 localStorage）
npm test           # 单元测试（vitest）
npm run typecheck
npm run icons      # 用 public/logo.svg、logo-small.svg 重新生成 public/icons/*.png
```

## 许可证

[MIT](LICENSE)。构建时会把打包进扩展的第三方库许可证汇总到 `dist/THIRD_PARTY_LICENSES.txt`（`scripts/third-party-licenses.mjs`）；某个库没带许可证文件时，从 `scripts/licenses/` 取上游原文，两处都没有就构建失败。

隐私政策：[docs/privacy.md](docs/privacy.md)。上架资料：[CHROMEWEBSTORE.md](CHROMEWEBSTORE.md)。
