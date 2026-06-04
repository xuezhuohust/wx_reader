const { loadIdentity, saveIdentity } = require('./utils/storage')
const api = require('./utils/api')

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
    // Cache for Home Data
    homeCache: {
      recommendBooks: null,
      libraryBooks: null,
      lastUpdated: 0,
    },
    // 隐私授权待处理
    _privacyResolve: null,
  },

  onLaunch() {
    this.globalData.identity = loadIdentity()
    this.setupNavBar()
  },

  resolvePrivacy(agreed, event) {
    const resolve = this.globalData._privacyResolve
    if (resolve) {
      const payload = { event: agreed ? 'agree' : 'disagree' }
      const buttonId = event
        && (
          (event.detail && event.detail.buttonId)
          || (event.currentTarget && event.currentTarget.id)
          || (event.target && event.target.id)
        )
      if (buttonId) {
        payload.buttonId = buttonId
      }
      resolve(payload)
      this.globalData._privacyResolve = null
    }
  },

  switchUserRole(role) {
    return api.switchUserRole(role)
      .then((identity) => {
        const nextIdentity = saveIdentity(Object.assign({}, this.globalData.identity, identity, {
          updatedAt: Date.now(),
        }))
        this.globalData.identity = nextIdentity
        return nextIdentity
      })
  },

  setupNavBar() {
    const windowInfo = typeof wx.getWindowInfo === 'function'
      ? wx.getWindowInfo()
      : wx.getSystemInfoSync()
    const menuButtonInfo = wx.getMenuButtonBoundingClientRect()

    this.globalData.statusBarHeight = windowInfo.statusBarHeight
    this.globalData.menuRight = windowInfo.screenWidth - menuButtonInfo.right
    this.globalData.menuTop = menuButtonInfo.top
    this.globalData.menuHeight = menuButtonInfo.height
    this.globalData.menuWidth = menuButtonInfo.width
    this.globalData.navBarHeight = (menuButtonInfo.top - windowInfo.statusBarHeight) * 2 + menuButtonInfo.height + windowInfo.statusBarHeight
  },
})
