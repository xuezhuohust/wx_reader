const api = require('../../utils/api')
const { formatPrice } = require('../../utils/format')
const { ensureRole } = require('../../utils/role')

Page({
  data: {
    book: null,
    priceText: '',
    scrolled: false,
    scene: 'user',
    isPublisherScene: false,
    pageTitle: '书本详情',
    chaptersExpanded: false,
    visibleChapters: [],
    chapterCount: 0,
    hasHiddenChapters: false,
    loading: true,
    hasProgress: false,
    displayCopyright: '',
    displayWordCount: '暂无',
    displayRating: '暂无',
    isLargeScreen: false,
    windowHeight: 0,
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
    const pageTitle = '书本详情'
    
    const app = getApp()
    const layout = app.refreshLayout('book-detail:onLoad')
    this.setData({
      scene,
      isPublisherScene,
      pageTitle,
      navBarHeight: app.globalData.navBarHeight,
      menuRight: app.globalData.menuRight,
      menuTop: app.globalData.menuTop,
      menuHeight: app.globalData.menuHeight,
      menuWidth: app.globalData.menuWidth,
      isLargeScreen: layout.isLandscapePad,
      windowHeight: layout.height,
    })
    wx.setNavigationBarTitle({
      title: pageTitle,
    })
  },

  onResize(res) {
    const nextIsLargeScreen = getApp()
      .refreshLayout('book-detail:onResize', res && res.size)
      .isLandscapePad
    const layout = getApp().globalData.layout
    if (nextIsLargeScreen !== this.data.isLargeScreen || layout.height !== this.data.windowHeight) {
      this.setData({ isLargeScreen: nextIsLargeScreen, windowHeight: layout.height })
    }
  },

  handleAppLayoutChange(size) {
    this.onResize({ size })
  },

  handleBack() {
    wx.navigateBack({
      fail: () => {
        wx.switchTab({
          url: '/pages/index/index',
        })
      }
    })
  },

  onPageScroll(e) {
    const scrollTop = (e.detail && e.detail.scrollTop) || e.scrollTop || 0
    const isScrolled = scrollTop > 50
    if (isScrolled !== this.data.scrolled) {
      this.setData({
        scrolled: isScrolled,
      })
    }
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
    this.setData({ loading: true })
    api.getBookById(this.bookId)
      .then((book) => {
        if (!book) {
          throw new Error('书籍数据加载失败')
        }
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

        // 检查本地进度
        const allProgress = wx.getStorageSync('reading_progress') || {}
        const hasProgress = !!allProgress[book.id]

        // 尝试从多个可能的字段中获取目录数据
        const chapters = Array.isArray(book.chapters) ? book.chapters : (Array.isArray(book.catalog) ? book.catalog : (Array.isArray(book.sections) ? book.sections : []))
        const chaptersExpanded = false
        this.setData({
          book,
          hasProgress,
          priceText: formatPrice(book.price),
          displayCopyright: this.normalizeDisplayCopyright(book.copyright),
          displayWordCount: this.formatWordCount(
            book.wordCount || book.word_count || book.words || book.totalWords
          ),
          displayRating: this.formatRating(book.rating || book.score || book.ratingScore),
          chaptersExpanded,
          visibleChapters: this.getVisibleChapters(chapters, chaptersExpanded),
          chapterCount: chapters.length,
          hasHiddenChapters: chapters.length > this.getChapterPreviewCount(),
          loading: false
        })
      })
      .catch((error) => {
        console.error('loadBook failed:', error)
        wx.showToast({
          title: error.message || '书籍加载失败',
          icon: 'none',
        })
        this.setData({ loading: false })
      })
      .finally(() => {
        if (typeof done === 'function') {
          done()
        }
      })
  },

  getChapterPreviewCount() {
    return 6
  },

  normalizeDisplayCopyright(value) {
    const text = String(value || '').trim()
    const emptyValues = ['无', '暂无', '暂无版权', '无版权', 'null', 'undefined', 'none', '-']
    if (!text || emptyValues.indexOf(text.toLowerCase()) >= 0) {
      return ''
    }
    return text
  },

  formatWordCount(value) {
    if (value === null || value === undefined || value === '') {
      return '暂无'
    }

    const count = Number(value)
    if (Number.isFinite(count) && count >= 0) {
      if (count >= 10000) {
        const formatted = (count / 10000).toFixed(count % 10000 === 0 ? 0 : 1)
        return `${formatted} 万字`
      }
      return `${Math.round(count)} 字`
    }

    return String(value).trim() || '暂无'
  },

  formatRating(value) {
    if (value === null || value === undefined || value === '') {
      return '暂无'
    }

    const rating = Number(value)
    if (Number.isFinite(rating)) {
      return `${rating.toFixed(Number.isInteger(rating) ? 0 : 1)} 分`
    }

    return String(value).trim() || '暂无'
  },

  getVisibleChapters(chapters, expanded) {
    const safeChapters = Array.isArray(chapters) ? chapters : []
    if (expanded) {
      return safeChapters
    }
    return safeChapters.slice(0, this.getChapterPreviewCount())
  },

  handleToggleChapters() {
    const { book, chaptersExpanded } = this.data
    if (!book) return

    // 尝试从多个可能的字段中获取目录数据，保持与 loadBook 逻辑一致
    const chapters = Array.isArray(book.chapters) ? book.chapters : (Array.isArray(book.catalog) ? book.catalog : (Array.isArray(book.sections) ? book.sections : []))
    const nextExpanded = !chaptersExpanded
    
    this.setData({
      chaptersExpanded: nextExpanded,
      visibleChapters: this.getVisibleChapters(chapters, nextExpanded),
    })
  },

  handleAction() {
    const { book } = this.data
    if (!book) return

    if (book.purchased) {
      this.handleContinueRead()
      return
    }

    wx.showLoading({ title: '正在处理...' })
    api.purchaseBook(book.id)
      .then(() => {
        wx.hideLoading()
        wx.showToast({
          title: '解锁成功',
          icon: 'success'
        })
        this.loadBook()
      })
      .catch((error) => {
        wx.hideLoading()
        wx.showToast({
          title: error.message || '操作失败',
          icon: 'none'
        })
      })
  },

  handleContinueRead() {
    const { book } = this.data
    if (!book) return

    if (!book.purchased) {
      wx.showToast({
        title: '请先购买后再阅读',
        icon: 'none',
      })
      return
    }

    wx.navigateTo({
      url: `/pages/read/read?id=${encodeURIComponent(book.id)}`,
    })
  },

  handleToggleOnline() {
    this.handleToggleOnlineStatus()
  },

  handleDelete() {
    const { book } = this.data
    if (!book) return

    wx.showModal({
      title: '删除确认',
      content: `确定要删除《${book.title}》吗？`,
      success: (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '删除中……' })
          api.deleteBook(book.id)
            .then(() => {
              wx.hideLoading()
              wx.showToast({
                title: '删除成功',
                icon: 'success',
              })
              setTimeout(() => {
                wx.navigateBack()
              }, 1500)
            })
            .catch((err) => {
              wx.hideLoading()
              wx.showToast({
                title: err.message || '删除失败',
                icon: 'none',
              })
            })
        }
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

    wx.showLoading({ title: '购买中……' })
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
      url: `/pages/chat/chat?bookId=${book.id}&entry=chat`,
    })
  },

  handleStartStory() {
    const { book } = this.data
    if (!book) {
      return
    }
    if (!book.purchased) {
      wx.showToast({
        title: '请先购买后再听故事',
        icon: 'none',
      })
      return
    }
    wx.navigateTo({
      url: `/pages/chat/chat?bookId=${book.id}&entry=story&scene=story`,
    })
  },

  handleStartCreative() {
    const { book } = this.data
    if (!book) {
      return
    }
    if (!book.purchased) {
      wx.showToast({
        title: '请先购买后再二创',
        icon: 'none',
      })
      return
    }
    wx.navigateTo({
      url: `/pages/chat/chat?bookId=${book.id}&entry=creative&scene=creative`,
    })
  },

  handleReadChapter(e) {
    const { index } = e.currentTarget.dataset
    const { book } = this.data
    if (!book) return

    if (!book.purchased) {
      wx.showToast({
        title: '请先购买后再阅读',
        icon: 'none',
      })
      return
    }

    wx.navigateTo({
      url: `/pages/read/read?id=${encodeURIComponent(book.id)}&index=${index}`,
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
