const { bootstrapUserIdentity } = require('../../services/user')
const { clearIdentity } = require('../../utils/storage')

Page({
  data: {
    current: 0,
    hasReadIcon: false,
    hasUserIcon: false,
    showDebugCodeTrigger: false
  },

  onLoad() {
    // 进入引导页时清除旧的登录状态，确保点击按钮才会触发登录接口
    clearIdentity()
    let envVersion = 'release'
    try {
      const info = wx.getAccountInfoSync && wx.getAccountInfoSync()
      envVersion = info && info.miniProgram && info.miniProgram.envVersion
        ? info.miniProgram.envVersion
        : envVersion
    } catch (e) {}
    this.setData({
      showDebugCodeTrigger: envVersion !== 'release'
    })
  },

  onSwiperChange(e) {
    this.setData({
      current: e.detail.current
    })
  },

  nextSlide() {
    const next = this.data.current + 1
    if (next < 2) {
      this.setData({
        current: next
      })
    }
  },

  handleLogin() {
    // Set guide as shown
    wx.setStorageSync('guide_shown', true)
    
    // Call real login service
    bootstrapUserIdentity()
      .then((identity) => {
        if (identity) {
          wx.reLaunch({
            url: '/pages/index/index'
          })
        }
      })
      .catch((err) => {
        console.error('Login failed in guide:', err)
        // Even if login fails, we still allow user to enter (they might be in offline mode or try later)
        wx.reLaunch({
          url: '/pages/index/index'
        })
      })
  },

  handleGetWxCodeOnly() {
    wx.login({
      success: (res) => {
        const code = res && res.code ? String(res.code) : ''
        if (!code) {
          wx.showToast({ title: '未获取到 code', icon: 'none' })
          return
        }
        console.info('[auth] wx.login code', code)
        wx.setClipboardData({
          data: code,
          success: () => {
            wx.showToast({ title: 'code 已复制', icon: 'none' })
          },
          fail: () => {
            wx.showToast({ title: '复制失败', icon: 'none' })
          }
        })
      },
      fail: () => {
        wx.showToast({ title: 'wx.login 失败', icon: 'none' })
      }
    })
  }
})
