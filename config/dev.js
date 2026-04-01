module.exports = {
  logger: {
    quiet: false,
    stats: true
  },
  // 2.4 修复：把 API 地址从业务代码收口到配置（便于 dev/prod 切换）
  defineConstants: {
    API_BASE_URL: JSON.stringify('https://api.zhanghaoyang.cn/api')
  },
  mini: {},
  h5: {}
}
