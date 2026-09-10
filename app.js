const { loadIdentity, saveIdentity } = require('./utils/storage')
const api = require('./utils/api')
const { getLayoutProfile } = require('./utils/layout')

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
    layout: null,
    isLandscapePad: false,
    // 安卓 Pad 的 systemInfo 在旋转首帧可能仍是旧方向；保存旋转事件值供
    // 当前页立即刷新布局，随后再用稳定后的窗口尺寸校正。
    deviceOrientationOverride: '',
    // 横屏阅读页仅通过 JS 内存共享二创所需原文片段，避免跨组件 setData 复制大文本。
    readerOriginalContext: null,
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
    this.refreshLayout('onLaunch')
    this.setupNavBar()

    if (typeof wx.onWindowResize === 'function') {
      wx.onWindowResize((event) => {
        this.refreshLayout('windowResize', event && event.size)
        this.setupNavBar()
        this.notifyCurrentPageLayoutChange(event && event.size)
      })
    }

    if (typeof wx.onDeviceOrientationChange === 'function') {
      wx.onDeviceOrientationChange((event) => {
        const orientation = String((event && (event.value || event.deviceOrientation)) || '').toLowerCase()
        if (orientation !== 'landscape' && orientation !== 'portrait') return
        this.globalData.deviceOrientationOverride = orientation
        this.refreshLayout('deviceOrientationChange')
        this.setupNavBar()
        this.notifyCurrentPageLayoutChange()

        clearTimeout(this._layoutSettleTimer)
        this._layoutSettleTimer = setTimeout(() => {
          this.refreshLayout('deviceOrientationSettled')
          this.setupNavBar()
          this.notifyCurrentPageLayoutChange()
        }, 180)
      })
    }
  },

  onShow() {
    // 真机扫码回到小程序时再记录一次，便于确认 Pad 横屏的实际窗口尺寸。
    this.refreshLayout('onShow')
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
    const layout = this.globalData.layout || getLayoutProfile()
    const windowInfo = layout.windowInfo
    const menuButtonInfo = wx.getMenuButtonBoundingClientRect()

    this.globalData.statusBarHeight = windowInfo.statusBarHeight
    // menuButton 的坐标属于当前窗口；分屏/Pad 下 screenWidth 可能与其不一致。
    this.globalData.menuRight = (windowInfo.windowWidth || windowInfo.screenWidth) - menuButtonInfo.right
    this.globalData.menuTop = menuButtonInfo.top
    this.globalData.menuHeight = menuButtonInfo.height
    this.globalData.menuWidth = menuButtonInfo.width
    this.globalData.navBarHeight = (menuButtonInfo.top - windowInfo.statusBarHeight) * 2 + menuButtonInfo.height + windowInfo.statusBarHeight
  },

  notifyCurrentPageLayoutChange(size) {
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
    const currentPage = pages && pages[pages.length - 1]
    if (currentPage && typeof currentPage.handleAppLayoutChange === 'function') {
      currentPage.handleAppLayoutChange(size)
    }
  },

  refreshLayout(source, windowInfo) {
    // 开发者工具旋转后常保留上一帧 windowWidth/windowHeight，但
    // deviceOrientation 已经更新。只在旋转/重算路径中优先采用该方向，
    // 首次进入横屏模拟器仍保持按窗口比例判断。
    const preferReportedOrientation = /(?:resize|orientation|layoutchange|syncreaderlayout)/i.test(String(source || ''))
    const layout = getLayoutProfile(windowInfo, this.globalData.deviceOrientationOverride, {
      preferReportedOrientation,
    })
    this.globalData.layout = layout
    this.globalData.isLandscapePad = layout.isLandscapePad

    // 使用 warn：开发者工具的 Console 默认也会显示，且在首页显示前就会执行。
    console.warn('[device-layout]', {
      source,
      deviceType: layout.deviceType || '(unavailable)',
      model: layout.model || '(unavailable)',
      deviceOrientation: layout.orientation || '(unavailable)',
      windowWidth: layout.width,
      windowHeight: layout.height,
      screenWidth: layout.screenWidth,
      screenHeight: layout.screenHeight,
      isPad: layout.isPad,
      isLandscapePad: layout.isLandscapePad,
    })
    return layout
  },
})
