# wx_reader — AI 读书助手（微信小程序）

基于 AI 对话的微信读书小程序，支持智能问答、多对话管理、语音交互，配合 `wx_reader_backend` 后端提供服务。

---

## 项目结构

```
wx_reader/
├── app.js                        # 应用入口（全局数据、导航栏尺寸、角色切换）
├── app.json                      # 页面注册、tabBar 配置、窗口样式
├── app.wxss                      # 全局样式（Notion 风格设计系统）
├── sitemap.json                  # 站点地图（搜索引擎收录规则）
├── project.config.json           # 微信开发者工具项目配置
├── package.json                  # 依赖声明（typings 仅开发依赖）
│
├── pages/                        # 所有页面
│   ├── index/                    # 首页——发现页（推荐书籍、书库）
│   ├── bookshelf/                # 书架页（已购书籍列表）
│   ├── my-books/                 # 我的页面（头像、角色切换、已购列表）
│   ├── book-detail/              # 书籍详情页（元信息、购买、聊天入口）
│   ├── chat/                     # AI 对话页（流式问答、语音交互、多对话切换）
│   └── publisher/                # 发布者角色页面组
│       ├── index/                # 仪表盘（统计数据）
│       ├── books/                # 管理书籍列表
│       ├── upload/               # 上传新书
│       └── build/                # 建库进度管理
│
├── components/                   # 可复用组件
│   ├── book-card/                # 书籍卡片（封面、标题、作者、价格标签）
│   ├── empty-state/              # 空状态占位（无书籍/无数据时的提示）
│   └── status-tag/               # 状态标签（上架/下架/建库中/已完成等）
│
├── custom-tab-bar/               # 自定义底部导航栏
│   └── index.js/wxml/wxss/json  # 根据用户角色（reader/publisher）动态切换 tab
│
├── utils/                        # 工具函数
│   ├── api.js                    # 后端 API 封装（所有 HTTP 请求入口）
│   ├── request.js                # 请求核心（认证头注入、401 自动重试、流式分块）
│   ├── storage.js                # 本地存储（用户身份持久化）
│   ├── format.js                 # 格式化工具（日期、价格、状态文案映射）
│   ├── role.js                   # 角色工具（reader/publisher 判断、标签）
│   └── tab-bar.js                # TabBar 逻辑（按角色切换 tab 项）
│
├── services/                     # 业务服务（早期分离，引用于 utils）
│   └── user.js                   # 用户认证服务（loginWithWechat、bootstrapUserIdentity）
│
├── typings/                      # TypeScript 类型定义（仅辅助开发）
│   └── types/wx/                 # 微信原生 API 类型补充
│
└── miniprogram/                  # 废弃/遗留目录（较旧的 TS 脚手架骨架）
```

---

## 页面路由

### 5 个 tab 页面

| 路径 | 名称 | Reader 可见 | Publisher 可见 |
|---|---|---|---|
| `pages/bookshelf/bookshelf` | 书架 | ✅ | ❌ |
| `pages/index/index` | 首页（发现） | ✅ | ❌ |
| `pages/my-books/my-books` | 我的 | ✅ | ✅ |
| `pages/publisher/books` | 管理 | ❌ | ✅ |
| `pages/publisher/index` | 仪表盘 | ❌ | ✅ |

### 4 个普通页面

| 路径 | 名称 | 入口 |
|---|---|---|
| `pages/book-detail/book-detail` | 书籍详情 | 点击书籍卡片进入 |
| `pages/chat/chat` | AI 对话 | 点击书籍详情页"开始对话" |
| `pages/publisher/upload` | 上传书籍 | 管理页"上传"按钮 |
| `pages/publisher/build` | 建库进度 | 管理页书籍建库操作 |

---

## 用户角色

小程序支持两种角色，通过底部 tabBar 切换：

| 角色 | 说明 | 可用页面 |
|---|---|---|
| **reader**（读者） | 默认角色，浏览和购买书籍、AI 对话 | 书架、首页、我的 |
| **publisher**（发布者） | 上传书籍、管理上架状态、查看数据 | 管理、仪表盘、我的 |

切换角色后，`custom-tab-bar` 动态渲染对应的 tab 项。

---

## API 接入

所有后端请求通过 `utils/api.js` 封装，认证自动注入。

| 模块 | API 函数 | 说明 |
|---|---|---|
| 认证 | `ensureUserIdentity()` | 微信登录 + 身份引导（自动） |
| 书籍 | `getRecommendBooks()` | 推荐书籍 |
| | `getAllBooks()` | 全量书库 |
| | `getBookCategories()` | 书籍类目枚举（API 服务提供） |
| | `getBookCategoryTabs()` | 读者侧筛选类目（含“全部”） |
| | `getBookCategoryPicker(category)` | 发布者表单 picker 类目与选中项 |
| | `getPurchasedBooks()` | 已购书籍 |
| | `getBookById(id)` | 书籍详情 |
| | `purchaseBook(id)` | 购买 |
| 对话 | `sendBookChatMessageStream()` | 流式 AI 问答 |
| | `listConversations(bookId)` | 对话列表 |
| | `createConversation(bookId)` | 新建对话 |
| | `getConversationMessages(id)` | 历史消息 |
| TTS | `requestSpeech(text)` | 文字转语音 |
| STT | `speechToText(filePath)` | 语音转文字 |
| 发布者 | `getPublisherStats()` | 统计数据 |
| | `getPublisherBooks()` | 书籍管理列表 |
| | `uploadBook(formData)` | 上传书籍 |
| | `updateBookOnlineStatus(id, status)` | 上下架 |
| | `startBuildBook(id)` | 启动建库 |

---

## 页面功能说明

### 首页（`pages/index/index`）
- 推荐书籍列表（横向滚动）
- 全部书库（纵向列表）
- 搜索入口（跳转书架页搜索）

### 书架（`pages/bookshelf/bookshelf`）
- 已购书籍列表
- 搜索/筛选
- 点击进入书籍详情

### 书籍详情（`pages/book-detail/book-detail`）
- 书籍封面、作者、描述
- 购买按钮
- 进入 AI 对话
- 发布者模式下额外：上下架开关、建库操作、删除

### AI 对话（`pages/chat/chat`）
- **多对话管理**：同一本书可创建多个独立对话
- **流式输出**：SSE 分块，逐句实时展示 AI 回复
- **语音交互**：录音输入 → STT 识别 → 发送；AI 回复 → TTS 朗读
- **快捷提问**：预置"总结这本书"等 4 个快捷问题
- **历史持久化**：对话消息落数据库，刷新/重新进入不丢失

### 发布者管理（`pages/publisher/books`）
- 已上传书籍列表
- 上下架操作
- 建库（知识库构建）入口
- 上传新书跳转

---

## 后端依赖

此小程序需配合 `wx_reader_backend` 使用（NestJS + PostgreSQL + NovelIndex 服务），详见 `../wx_reader_backend/README.md`。

后端 API 地址配置在 `utils/request.js` 中：

```javascript
const BASE_URL = 'https://xiandianzigyy.cloud/reader'
```

书籍类目由 API 服务统一提供，外部接口说明见 `../wx_reader_backend/docs/书籍类目接口说明.md`。

---
