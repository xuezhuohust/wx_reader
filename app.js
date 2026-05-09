const { loadIdentity } = require('./utils/storage')

App({
  globalData: {
    libraryKeyword: '',
    identity: null,
    publisherBuildIntent: null,
    navBarHeight: 0,
    statusBarHeight: 0,
    menuRight: 0,
    menuTop: 0,
    menuHeight: 0,
    menuWidth: 0,
  },

  onLaunch() {
    this.globalData.identity = loadIdentity()
    this.setupNavBar()
  },

  setupNavBar() {
    const systemInfo = wx.getSystemInfoSync()
    const menuButtonInfo = wx.getMenuButtonBoundingClientRect()

    this.globalData.statusBarHeight = systemInfo.statusBarHeight
    this.globalData.menuRight = systemInfo.screenWidth - menuButtonInfo.right
    this.globalData.menuTop = menuButtonInfo.top
    this.globalData.menuHeight = menuButtonInfo.height
    this.globalData.menuWidth = menuButtonInfo.width
    this.globalData.navBarHeight = (menuButtonInfo.top - systemInfo.statusBarHeight) * 2 + menuButtonInfo.height + systemInfo.statusBarHeight
  },
})
