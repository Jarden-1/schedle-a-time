const path = require('path');

const config = {
  projectName: 'time-scheduler',
  date: '2026-3-10',
  // 以 375 为设计稿宽度：把现有的 px 设计值转换成更符合手机习惯的 rpx（例如 14px -> 28rpx）
  designWidth: 375,
  deviceRatio: {
    375: 2,
    640: 2.34 / 2,
    750: 1,
    828: 1.81 / 2
  },
  sourceRoot: 'src',
  outputRoot: 'dist',
  plugins: [],
  defineConstants: {},
  alias: {
    '@': path.resolve(__dirname, '..', 'src')
  },
  copy: {
    patterns: [{ from: 'icon', to: 'dist/icon' }],
    options: {}
  },
  framework: 'react',
  compiler: {
    type: 'webpack5',
    prebundle: {
      enable: false,
      force: false
    }
  },
  cache: {
    enable: false
  },
  mini: {
    enableSourceMap: true,
    optimizeMainPackage: {
      enable: true
    },
    webpackChain(chain) {
      chain.merge({
        optimization: {
          splitChunks: {
            cacheGroups: {
              taro: {
                name: 'taro',
                test: module => {
                  return /@tarojs[\\/][a-z]+/.test(module.context)
                },
                priority: 100
              }
            }
          }
        }
      });
    },
    commonChunks: ['runtime', 'vendors', 'taro', 'common'],
    postcss: {
      pxtransform: {
        enable: true,
        config: {}
      },
      url: {
        enable: true,
        config: {
          limit: 1024
        }
      },
      cssModules: {
        enable: false,
        config: {
          namingPattern: 'module',
          generateScopedName: '[name]__[local]___[hash:base64:5]'
        }
      }
    }
  },
  h5: {
    publicPath: '/',
    staticDirectory: 'static',
    esnextModules: ['taro-ui'],
    postcss: {
      autoprefixer: {
        enable: true,
        config: {}
      },
      cssModules: {
        enable: false,
        config: {
          namingPattern: 'module',
          generateScopedName: '[name]__[local]___[hash:base64:5]'
        }
      }
    }
  },
  rn: {
    appName: 'taroDemo',
    postcss: {
      cssModules: {
        enable: false
      }
    }
  }
}

module.exports = function (merge) {
  if (process.env.NODE_ENV === 'development') {
    return merge({}, config, require('./dev'))
  }
  return merge({}, config, require('./prod'))
}
