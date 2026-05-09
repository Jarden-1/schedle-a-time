# 约时间助手 Time Scheduler

一个帮助多人快速协调共同空闲时间的微信小程序。

## 产品功能

- **创建事件**：发起人创建约时间事件，设置日期范围、时间段和粒度
- **分享邀请**：通过微信好友或群聊邀请参与者
- **时间选择**：参与者在可视化网格中勾选空闲时间
- **成员协作**：支持参与者列表、代填、管理员、VIP 和成员管理
- **智能推荐**：系统统计参与情况并推荐最佳时间段
- **一键确认**：发起人确认最终时间，完成协调
- **个人资料**：维护昵称、头像和个人参与统计

## 技术栈

- **框架**：Taro 3.x + React 18
- **语言**：TypeScript
- **样式**：SCSS
- **状态管理**：Zustand
- **后端接口**：自建 HTTP API，当前基础地址为 `https://api.zhanghaoyang.cn/api`
- **工具**：Day.js、classnames

> 当前项目已不再使用微信云函数 / 微信云数据库。前端通过 `Taro.request` 请求自建后端 API，核心配置位于 `src/store/index.ts`。

## 项目结构

```text
time-scheduler/
├── src/
│   ├── app.tsx              # 应用入口
│   ├── app.config.ts        # 应用配置和页面路由
│   ├── app.scss             # 全局样式
│   ├── assets/              # 静态资源
│   ├── components/          # 通用组件
│   ├── custom-tab-bar/      # 自定义 TabBar
│   ├── hooks/               # 自定义 Hooks
│   │   └── useCloudFunction.ts # 旧云函数调用的兼容占位，实际链路已停用
│   ├── pages/
│   │   ├── index/           # 首页（事件列表）
│   │   ├── create/          # 创建事件页
│   │   ├── profile/         # 我的页面
│   │   └── event/
│   │       ├── detail/       # 事件详情
│   │       ├── participants/ # 参与者列表
│   │       ├── select/       # 时间选择
│   │       ├── decision/     # 决策面板
│   │       └── slot-detail/  # 时间段详情
│   ├── store/               # Zustand 状态和 API 请求封装
│   ├── types/               # TypeScript 类型定义
│   └── utils/               # 工具函数
├── config/                  # Taro 构建配置
├── icon/                    # TabBar 图标
├── types/                   # 全局类型声明
├── project.config.json      # 微信开发者工具项目配置
└── package.json
```

## 运行前准备

### 1. 安装依赖

```bash
npm install
```

### 2. 配置小程序 AppID

编辑 `project.config.json` 中的 `appid`：

```json
{
  "appid": "你的微信小程序 AppID"
}
```

### 3. 配置后端 API

当前 API 基础地址在 `src/store/index.ts`：

```ts
export const BASE_URL = 'https://api.zhanghaoyang.cn/api';
```

本地开发或切换环境时，将它改成对应后端地址即可，例如：

```ts
export const BASE_URL = 'http://localhost:3000/api';
```

微信小程序真机访问线上接口时，需要在微信公众平台把后端域名加入「服务器域名」配置。

### 4. 启动开发构建

```bash
npm run dev:weapp
```

### 5. 导入微信开发者工具

1. 打开微信开发者工具
2. 选择「导入项目」
3. 选择本项目目录
4. 填写小程序 AppID
5. 使用 `dist/` 作为小程序源码目录

## 常用命令

```bash
npm run dev:weapp      # 微信小程序开发构建
npm run build:weapp    # 微信小程序生产构建
npm run build:h5       # H5 构建
```

## 页面说明

| 页面 | 路径 | 功能 |
|------|------|------|
| 首页 | `/pages/index/index` | 展示事件列表，支持筛选和下拉刷新 |
| 创建事件 | `/pages/create/index` | 创建约时间事件 |
| 事件详情 | `/pages/event/detail/index` | 查看事件详情、参与情况和分享入口 |
| 参与者列表 | `/pages/event/participants/index` | 查看和管理参与者 |
| 选择时间 | `/pages/event/select/index` | 勾选空闲时间，支持代填 |
| 决策面板 | `/pages/event/decision/index` | 查看统计结果并确认最终时间 |
| 时间段详情 | `/pages/event/slot-detail/index` | 查看某时间段的参与者状态 |
| 我的 | `/pages/profile/index` | 个人资料和统计 |

## 数据流说明

- 登录：`Taro.login()` 获取微信临时 code，再请求自建后端 `/login` 换取 `openid` 和 token
- 事件列表：通过 `/events` 获取，并缓存到本地 storage
- 事件创建、更新、删除：通过自建后端事件接口完成
- 参与时间、确认时间、成员管理：通过事件子接口同步到后端
- 头像上传：上传地址由 `UPLOAD_URL = ${BASE_URL}/upload` 统一生成

## 常见问题

### Q: 这个项目还需要部署微信云函数吗？

A: 不需要。当前代码已经迁移到自建 HTTP API，不再依赖 `cloud/functions`。

### Q: 分享后别人打不开或拿不到事件数据？

A: 优先检查自建后端接口是否正常、接口域名是否配置到微信小程序服务器域名、以及 `BASE_URL` 是否指向正确环境。

### Q: 创建事件失败怎么办？

A: 检查是否完成微信登录、用户昵称头像是否已设置、后端 `/events` 接口是否可访问。

### Q: 为什么还有 `useCloudFunction.ts`？

A: 这是旧云函数调用链路的兼容占位。当前实现会直接提示云函数链路已移除，实际业务请求集中在 `src/store/index.ts`。

## License

MIT
