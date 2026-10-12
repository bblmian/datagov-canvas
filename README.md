# DBML Studio（Chrome 扩展）

一个离线运行的 Chrome 扩展：左边写 [DBML](https://dbml.dbdiagram.io/docs)，右边实时生成数据库 ER 图。功能上参照 dbdiagram.io 的核心部分自己实现，和 dbdiagram.io / Holistics 没有关系。DBML 的解析、SQL 导入导出用的是开源库 `@dbml/core`（Apache-2.0）。

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
npm run icons      # 重新生成 public/icons/*.png
```
