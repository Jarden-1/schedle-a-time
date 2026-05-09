export default defineAppConfig({
  pages: [
    'pages/index/index',
    'pages/create/index',
    'pages/event/detail/index',
    'pages/event/participants/index',
    'pages/event/select/index',
    'pages/event/decision/index',
    'pages/event/slot-detail/index',
    'pages/profile/index'
  ],
  window: {
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#fff',
    navigationBarTitleText: '约时间工具',
    navigationBarTextStyle: 'black'
  },
  tabBar: {
    custom: true,
    color: '#999999',
    selectedColor: '#07c160',
    backgroundColor: '#ffffff',
    borderStyle: 'black',
    list: [
      {
        pagePath: 'pages/index/index',
        text: '首页',
        iconPath: 'icon/home-unselected.png',
        selectedIconPath: 'icon/home-selected.png'
      },
      {
        pagePath: 'pages/profile/index',
        text: '我的',
        iconPath: 'icon/my-unselected.png',
        selectedIconPath: 'icon/my-selected.png'
      }
    ]
  }
})
