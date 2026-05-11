const { syncRoleTabBar } = require('../../utils/tab-bar')

Page({
  data: {
    navBarHeight: 0,
    statusBarHeight: 0,
  },

  onLoad() {
    const app = getApp()
    this.setData({
      navBarHeight: app.globalData.navBarHeight,
      statusBarHeight: app.globalData.statusBarHeight,
    })
  },

  onShow() {
    syncRoleTabBar(this, 'pages/bookshelf/bookshelf')
  },
})
