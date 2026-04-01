# 约时间助手 Time Scheduler

一个帮助多人快速协调共同空闲时间的微信小程序。

## 🎯 产品功能

- **创建事件**：发起人快速创建约时间事件，设置日期范围和时间段
- **分享邀请**：一键分享给微信好友或群聊
- **时间选择**：参与者在可视化网格中选择空闲时间
- **智能推荐**：系统自动统计并推荐最佳时间段（Top 3）
- **一键确认**：发起人确认最终时间，完成协调

## 🛠️ 技术栈

- **框架**：Taro 3.x + React 18
- **语言**：TypeScript
- **样式**：SCSS
- **状态管理**：Zustand
- **后端**：微信云开发（云函数 + 云数据库）
- **工具**：Day.js（日期处理）、classnames（类名管理）

## 📁 项目结构

```
time-scheduler/
├── src/
│   ├── app.tsx              # 应用入口
│   ├── app.config.ts        # 应用配置（7个页面路由）
│   ├── app.scss             # 全局样式
│   ├── components/          # 通用组件
│   │   ├── Loading/         # 加载组件
│   │   ├── EmptyState/      # 空状态组件
│   │   └── Skeleton/        # 骨架屏组件
│   ├── hooks/               # 自定义 Hooks
│   │   └── useCloudFunction.ts
│   ├── pages/
│   │   ├── index/           # 首页（事件列表）
│   │   ├── create/          # 创建事件页
│   │   ├── profile/         # 我的页面
│   │   └── event/
│   │       ├── detail/      # 事件详情
│   │       ├── select/      # 时间选择（网格勾选）
│   │       ├── decision/    # 决策面板（Top 3 推荐）
│   │       └── slot-detail/ # 时间段详情
│   ├── types/               # TypeScript 类型定义
│   ├── store/               # Zustand 状态管理
│   └── utils/               # 工具函数（日期处理等）
├── cloud/
│   └── functions/           # 5个云函数
│       ├── createEvent/     # 创建事件
│       ├── getEvent/        # 获取单个事件
│       ├── getEvents/       # 获取事件列表
│       ├── updateAvailability/ # 更新参与时间
│       └── confirmTime/     # 确认最终时间
├── config/                  # Taro 配置
├── types/                   # 全局类型声明
└── package.json
```

## ✨ 优化特性

### 性能优化
- ✅ 使用 `useMemo` 和 `useCallback` 优化渲染性能
- ✅ 骨架屏加载效果，提升 perceived performance
- ✅ 云函数调用防抖处理

### 用户体验
- ✅ 全屏 Loading 加载状态
- ✅ 空状态友好提示
- ✅ 下拉刷新支持
- ✅ 二次确认弹窗（重要操作）
- ✅ 页面分享支持

### 代码质量
- ✅ 自定义 Hooks 封装云函数调用
- ✅ 通用组件提取（Loading、EmptyState、Skeleton）
- ✅ TypeScript 完整类型支持
- ✅ 错误处理和重试机制

## 🚀 快速开始

### 1. 安装依赖

```bash
cd time-scheduler
npm install
```

### 2. 配置小程序 AppID

编辑 `project.config.json`，将 `appid` 替换为你的小程序 AppID：

```json
{
  "appid": "wx1234567890abcdef"  // 替换为你的 AppID
}
```

### 3. 开通云开发

1. 登录[微信公众平台](https://mp.weixin.qq.com/)
2. 进入你的小程序管理后台
3. 点击左侧菜单「云开发」→「开通」
4. 选择「微信云开发」，按提示完成开通

### 4. 配置云开发环境 ID

编辑 `src/app.tsx`，替换云开发环境 ID：

```typescript
const CLOUD_ENV_ID = 'your-cloud-env-id';  // 替换为你的环境 ID
```

**获取环境 ID：**
- 进入云开发控制台 → 设置 → 环境设置 → 复制「环境 ID」

### 5. 部署云函数

在微信开发者工具中：

1. 打开项目，确保已登录微信开发者账号
2. 点击左上角的「云开发」按钮进入云开发控制台
3. 在「数据库」中创建集合：`events`
4. 右键以下云函数文件夹，选择「创建并部署：云端安装依赖」：
   - `cloud/functions/createEvent/`
   - `cloud/functions/getEvent/`
   - `cloud/functions/getEvents/`
   - `cloud/functions/updateAvailability/`
   - `cloud/functions/confirmTime/`

### 6. 启动开发

```bash
npm run dev:weapp
```

### 7. 导入微信开发者工具

1. 打开微信开发者工具
2. 选择「导入项目」
3. 选择 `time-scheduler` 文件夹
4. 填写你的 AppID
5. 点击「导入」

## 📱 页面说明

| 页面 | 路径 | 功能 |
|------|------|------|
| 首页 | `/pages/index/index` | 展示事件列表，支持筛选、下拉刷新 |
| 创建事件 | `/pages/create/index` | 填写事件信息创建约时间 |
| 事件详情 | `/pages/event/detail/index` | 查看事件详情和参与情况，支持分享 |
| 选择时间 | `/pages/event/select/index` | 参与者勾选空闲时间，支持全选 |
| 决策面板 | `/pages/event/decision/index` | 发起人查看统计、Top 3推荐、确认时间 |
| 时间段详情 | `/pages/event/slot-detail/index` | 查看某时间段有谁有空/没空 |
| 我的 | `/pages/profile/index` | 个人中心和统计 |

## 🎨 设计特点

- **简洁直观**：界面清晰，操作门槛低
- **响应式布局**：适配各种屏幕尺寸
- **实时反馈**：操作有即时视觉反馈
- **绿色主题**：使用微信品牌绿色，自然友好
- **骨架屏**：加载时显示骨架屏，体验更流畅

## 🔧 常见问题

### Q: 分享给别人后，对方打开看不到事件？
A: 确保已部署 `getEvent` 云函数，并且在 `app.tsx` 中正确配置了云开发环境 ID。

### Q: 云函数调用失败？
A: 检查：
1. 是否正确配置了云开发环境 ID
2. 是否已在微信开发者工具中部署云函数
3. 数据库中是否创建了 `events` 集合

### Q: 如何添加更多页面？
A: 
1. 在 `src/pages/` 下创建新页面文件夹
2. 在 `src/app.config.ts` 的 `pages` 数组中添加页面路径
3. 如果需要在 TabBar 显示，在 `tabBar.list` 中添加配置

## 📄 License

MIT
