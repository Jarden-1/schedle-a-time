# TabBar 图标下载指南

由于浏览器服务暂时不可用，请按照以下步骤手动下载图标：

## 方案一：Iconfont 下载（推荐）

### 1. 访问 Iconfont
打开 https://www.iconfont.cn

### 2. 搜索图标
搜索关键词：
- **首页图标**：搜索 "home" 或 "首页"
- **个人图标**：搜索 "user" 或 "我的" 或 "person"

### 3. 选择图标风格
建议选择同一套图标库中的图标，确保风格一致：
- **线性风格**（推荐）：线条简洁，适合未选中状态
- **填充风格**：实心填充，适合选中状态

### 4. 下载设置
点击图标 → 下载 → 设置颜色：
- 未选中状态颜色：`#999999`（灰色）
- 选中状态颜色：`#07c160`（微信绿）

### 5. 尺寸设置
下载尺寸：
- @1x：81x81px
- @2x：162x162px（或直接下载 81px）

## 方案二：使用现成的图标库

### Feather Icons（免费开源）
https://feathericons.com/
- 搜索 "home" 和 "user"
- 设置颜色后下载

### Heroicons（免费开源）
https://heroicons.com/
- 搜索 "home" 和 "user"
- 选择 outline（未选中）和 solid（选中）版本

### Remix Icon（免费开源）
https://remixicon.com/
- 搜索 "home" 和 "user"
- 选择 line（未选中）和 fill（选中）版本

## 方案三：我推荐的图标风格

### 首页图标
```
未选中（home.png）：
- 简单的房子轮廓
- 线条粗细：2px
- 颜色：#999999

选中（home-active.png）：
- 实心填充的房子
- 颜色：#07c160
```

### 个人图标
```
未选中（profile.png）：
- 简单的人形轮廓
- 线条粗细：2px
- 颜色：#999999

选中（profile-active.png）：
- 实心填充的人形
- 颜色：#07c160
```

## 下载后放置位置

```
src/assets/icons/
├── home.png          (81x81px, 灰色 #999)
├── home-active.png   (81x81px, 绿色 #07c160)
├── profile.png       (81x81px, 灰色 #999)
└── profile-active.png (81x81px, 绿色 #07c160)
```

## 快速获取方式

如果你希望快速测试，可以使用以下方式：
1. 暂时删除 `app.config.ts` 中的图标配置
2. 只用文字标签（TabBar 支持只显示文字）
3. 后续再添加图标

---

**建议**：使用 Iconfont 的"阿里巴巴矢量图标库"，搜索"tabbar"或"底部导航"，有很多成套的图标可以直接使用。
