const api = require('../../utils/api')
const { formatPrice } = require('../../utils/format')
const { ensureRole } = require('../../utils/role')

Page({
  data: {
    book: null,
    priceText: '',
    scene: 'user',
    isPublisherScene: false,
    pageTitle: '书籍详情',
  },

  onLoad(options) {
    this.blockedByRole = false
    this.bookId = options.id
    const scene = options.scene === 'publisher' ? 'publisher' : 'user'
    if (scene === 'publisher' && !ensureRole('publisher')) {
      this.blockedByRole = true
      wx.showToast({
        title: '请先切换为出版社身份',
        icon: 'none',
      })
      wx.switchTab({
        url: '/pages/index/index',
      })
      return
    }
    const isPublisherScene = scene === 'publisher'
    const pageTitle = isPublisherScene ? '书目详情' : '书籍详情'
    
    const app = getApp()
    this.setData({
      scene,
      isPublisherScene,
      pageTitle,
      navBarHeight: app.globalData.navBarHeight,
      menuRight: app.globalData.menuRight,
      menuTop: app.globalData.menuTop,
      menuHeight: app.globalData.menuHeight,
      menuWidth: app.globalData.menuWidth,
    })
    wx.setNavigationBarTitle({
      title: pageTitle,
    })
  },

  handleBack() {
    wx.navigateBack()
  },

  onShow() {
    if (this.blockedByRole) {
      return
    }
    this.loadBook()
  },

  onPullDownRefresh() {
    this.loadBook(() => {
      wx.stopPullDownRefresh()
    })
  },

  loadBook(done) {
    api.getBookById(this.bookId)
      .then((book) => {
        if (!this.data.isPublisherScene && (book.onlineStatus !== 'online' || book.buildStatus !== 'done')) {
          wx.showToast({
            title: '该书暂未开放阅读',
            icon: 'none',
          })
          wx.switchTab({
            url: '/pages/index/index',
          })
          return
        }
        this.setData({
          book,
          priceText: formatPrice(book.price),
        })
      })
      .catch((error) => {
        console.error('loadBook failed:', error)
        wx.showToast({
          title: '书籍不存在',
          icon: 'none',
        })
      })
      .finally(() => {
        if (typeof done === 'function') {
          done()
        }
      })
  },

  handlePurchase() {
    const { book } = this.data
    if (!book || book.purchased) {
      wx.showToast({
        title: '你已经购买过了',
        icon: 'none',
      })
      return
    }

    wx.showLoading({ title: '购买中...' })
    api.purchaseBook(book.id)
      .then(() => {
        wx.hideLoading()
        wx.showToast({
          title: '购买成功',
          icon: 'success',
        })
        this.loadBook()
      })
      .catch(() => {
        wx.hideLoading()
        wx.showToast({
          title: '购买失败',
          icon: 'none',
        })
      })
  },

  handleStartChat() {
    const { book } = this.data
    if (!book) {
      return
    }
    if (!book.purchased) {
      wx.showToast({
        title: '请先购买后再对话',
        icon: 'none',
      })
      return
    }
    wx.navigateTo({
      url: `/pages/chat/chat?bookId=${book.id}`,
    })
  },

  handleGotoBuild() {
    const { book } = this.data

    getApp().globalData.publisherBuildIntent = {
      bookId: book ? book.id : '',
      autoStart: false,
    }

    wx.switchTab({
      url: '/pages/publisher/build',
    })
  },

  handleToggleOnlineStatus() {
    const { book, isPublisherScene } = this.data
    if (!book || !isPublisherScene) {
      return
    }

    if (book.buildStatus !== 'done') {
      wx.showToast({
        title: '请先完成建库',
        icon: 'none',
      })
      return
    }

    const nextStatus = book.onlineStatus === 'online' ? 'offline' : 'online'
    api.updateBookOnlineStatus(book.id, nextStatus)
      .then(() => {
        wx.showToast({
          title: nextStatus === 'online' ? '已上架' : '已下架',
          icon: 'success',
        })
        this.loadBook()
      })
      .catch((error) => {
        wx.showToast({
          title: error.message || '操作失败',
          icon: 'none',
        })
      })
  },
})
