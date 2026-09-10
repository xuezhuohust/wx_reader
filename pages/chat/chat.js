function getNavigationLayout(app) {
  app.setupNavBar()
  return {
    navBarHeight: Number(app.globalData.navBarHeight) || 64,
    menuTop: Number(app.globalData.menuTop) || 24,
    menuHeight: Number(app.globalData.menuHeight) || 32,
  }
}

Page({
  data: {
    chatProps: {},
    isLargeScreen: false,
    windowHeight: 0,
    navigationLayout: {},
  },

  onLoad(options) {
    const app = getApp()
    const layout = app.refreshLayout('chat:onLoad')
    // 组件会在 chatProps 写入后立即创建；先拿到导航安全区数据，避免首帧使用
    // App 初始化阶段的 0 值，导致导航、书籍标签和消息区同时挤到顶部。
    const navigationLayout = getNavigationLayout(app)
    this.setData({
      isLargeScreen: layout.isLandscapePad,
      windowHeight: layout.height,
      navigationLayout,
      chatProps: {
        bookId: (options && options.bookId) || '',
        entry: (options && (options.entry || options.entrance || options.scene || options.mode)) || 'chat',
        scene: (options && (options.scene || options.mode || options.entry)) || 'chat',
        chapterId: (options && options.chapterId) || '',
        chapterTitle: (options && options.chapterTitle) || '',
        initialText: (options && options.initialText) || '',
      },
    })
  },

  onResize(res) {
    const app = getApp()
    const layout = app.refreshLayout('chat:onResize', res && res.size)
    this.setData({
      isLargeScreen: layout.isLandscapePad,
      windowHeight: layout.height,
      navigationLayout: getNavigationLayout(app),
    })
  },

  handleAppLayoutChange(size) {
    this.onResize({ size })
  },
})
