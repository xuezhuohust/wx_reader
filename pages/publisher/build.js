const api = require('../../utils/api')
const { ensureRole } = require('../../utils/role')
const { syncRoleTabBar } = require('../../utils/tab-bar')

Page({
  data: {
    books: [],
  },

  onLoad(options) {
    this.applyBuildIntent({
      bookId: options.bookId,
      autoStart: options.autoStart === '1',
    })
    this.pendingBuildId = ''
  },

  onShow() {
    if (!this.guardPublisherRole()) {
      return
    }
    this.consumeBuildIntent()
    syncRoleTabBar(this, 'pages/publisher/build')
    this.loadBooks()
  },

  applyBuildIntent(intent) {
    const nextIntent = intent || {}
    this.focusBookId = nextIntent.bookId || ''
    this.autoStartBuild = !!nextIntent.autoStart
    this.autoStartConsumed = false
  },

  consumeBuildIntent() {
    const app = getApp()
    const intent = app && app.globalData ? app.globalData.publisherBuildIntent : null

    if (!intent || !intent.bookId) {
      return
    }

    app.globalData.publisherBuildIntent = null
    this.applyBuildIntent(intent)
  },

  loadBooks() {
    api.getPublisherBooks()
      .then((books) => {
        this.setData({ books })
        this.maybeAutoStartBuild(books)
      })
      .catch((error) => {
        console.error('loadBuildBooks failed:', error)
        this.setData({ books: [] })
      })
  },

  maybeAutoStartBuild(books) {
    if (!this.autoStartBuild || this.autoStartConsumed || !this.focusBookId) {
      return
    }

    const targetBook = (books || []).find((item) => item.id === this.focusBookId)
    if (!targetBook) {
      return
    }

    this.autoStartConsumed = true

    if (targetBook.buildStatus === 'done') {
      wx.showToast({
        title: '该书已完成建库',
        icon: 'none',
      })
      return
    }

    if (targetBook.buildStatus === 'building') {
      wx.showToast({
        title: '建库任务已启动',
        icon: 'none',
      })
      return
    }

    this.startBuild(targetBook.id)
  },

  patchBook(nextBook) {
    const books = this.data.books.map((item) => {
      return item.id === nextBook.id ? nextBook : item
    })
    this.setData({ books })
  },

  startBuild(id) {
    if (this.pendingBuildId === id) {
      return
    }

    const current = this.data.books.find((item) => item.id === id)
    if (!current) {
      return
    }
    if (current.buildStatus === 'building') {
      wx.showToast({
        title: '该书正在建库中',
        icon: 'none',
      })
      return
    }

    this.pendingBuildId = id

    api.startBuildBook(id, (book) => {
      this.patchBook(book)
    }).then((book) => {
      this.patchBook(book)
      wx.showToast({
        title: '建库完成',
        icon: 'success',
      })
    }).catch((error) => {
      wx.showToast({
        title: error.message || '建库失败',
        icon: 'none',
      })
    }).finally(() => {
      if (this.pendingBuildId === id) {
        this.pendingBuildId = ''
      }
    })
  },

  handleStartBuild(event) {
    const id = event.currentTarget.dataset.id
    this.startBuild(id)
  },

  guardPublisherRole() {
    if (ensureRole('publisher')) {
      return true
    }

    wx.showToast({
      title: '请先切换为出版社身份',
      icon: 'none',
    })
    wx.switchTab({
      url: '/pages/index/index',
    })
    return false
  },
})
