const { bootstrapUserIdentity } = require('../../services/user')
const { clearIdentity } = require('../../utils/storage')

Page({
  data: {
    current: 0,
    hasReadIcon: false,
    hasUserIcon: false
  },

  onLoad() {
    // 进入引导页时清除旧的登录状态，确保点击按钮才会触发登录接口
    clearIdentity()
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
  }
})
