const api = require('../../utils/api')
const { syncRoleTabBar } = require('../../utils/tab-bar')

Page({
  data: {
    navBarHeight: 0,
    statusBarHeight: 0,
    menuTop: 0,
    menuHeight: 0,
    books: [],
    allBooks: [], // Store all books for filtering
    loading: true,
    scrolled: false,
    searchValue: '',
  },

  onLoad() {
    const app = getApp()
    this.setData({
      navBarHeight: app.globalData.navBarHeight,
      statusBarHeight: app.globalData.statusBarHeight,
      menuTop: app.globalData.menuTop,
      menuHeight: app.globalData.menuHeight,
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
    const { getUserRole } = require('../../utils/role')
    const { loadIdentity } = require('../../utils/storage')
    const identity = loadIdentity()
    const role = getUserRole(identity)
    
    if (role === 'publisher') {
      wx.switchTab({
        url: '/pages/publisher/books',
      })
      return
    }

    syncRoleTabBar(this, 'pages/bookshelf/bookshelf')
    this.loadBookshelf()
  },

  onPullDownRefresh() {
    this.loadBookshelf(() => {
      wx.stopPullDownRefresh()
    })
  },

  isImageCoverValue(value) {
    const raw = String(value || '').trim()
    if (!raw) {
      return false
    }
    return /^(https?:\/\/|wxfile:\/\/|cloud:\/\/|data:image\/|\/)/.test(raw)
      || /\.(png|jpe?g|webp|gif|svg)(\?|#|$)/i.test(raw)
  },

  resolveCoverUrl(book) {
    const candidates = [
      book && book.coverUrl,
      book && book.cover_url,
      book && book.imageUrl,
      book && book.image_url,
      book && book.coverImage,
      book && book.cover_image,
    ]

    for (let i = 0; i < candidates.length; i += 1) {
      if (this.isImageCoverValue(candidates[i])) {
        return api.toAbsoluteUrl(candidates[i])
      }
    }

    if (book && this.isImageCoverValue(book.cover)) {
      return api.toAbsoluteUrl(book.cover)
    }

    return ''
  },

  loadBookshelf(done) {
    this.setData({ loading: true })
    api.getPurchasedBooks()
      .then((books) => {
        // 只把真实图片路径转成封面地址；cover-sunset 这类主题值不能当图片加载。
        const processedBooks = (books || []).map(book => {
          return Object.assign({}, book, {
            coverUrl: this.resolveCoverUrl(book),
          })
        })
        this.setData({
          allBooks: processedBooks,
          books: processedBooks,
          loading: false,
        })
      })
      .catch((error) => {
        console.error('[bookshelf] loadBookshelf failed', error)
        this.setData({
          loading: false,
        })
      })
      .finally(() => {
        if (typeof done === 'function') {
          done()
        }
      })
  },

  handleSearchInput(event) {
    const value = event.detail.value.toLowerCase()
    const filtered = this.data.allBooks.filter(book => 
      book.title.toLowerCase().includes(value) || 
      (book.author && book.author.toLowerCase().includes(value))
    )
    this.setData({
      searchValue: value,
      books: filtered
    })
  },

  handleSortTap() {
    // Simple toggle sort logic or show picker
    wx.showActionSheet({
      itemList: ['最近阅读', '按标题 A-Z', '按添加时间'],
      success: (res) => {
        let sorted = [...this.data.books]
        if (res.tapIndex === 1) {
          sorted.sort((a, b) => a.title.localeCompare(b.title))
        } else if (res.tapIndex === 2) {
          sorted.sort((a, b) => (b.purchaseTime || 0) - (a.purchaseTime || 0))
        }
        this.setData({ books: sorted })
      }
    })
  },

  handleBookTap(event) {
    const { book } = event.currentTarget.dataset
    wx.navigateTo({
      url: `/pages/book-detail/book-detail?id=${book.id}`,
    })
  },

  handleActionTap(event) {
    const { book } = event.currentTarget.dataset
    wx.navigateTo({
      url: `/pages/chat/chat?bookId=${book.id}`,
    })
  },

  handleExplore() {
    wx.switchTab({
      url: '/pages/index/index',
    })
  },

  handleImageError(e) {
    const { id } = e.currentTarget.dataset
    const failedId = String(id || '')
    const books = this.data.books.map((book) => (
      String(book.id || '') === failedId ? Object.assign({}, book, { coverUrl: '' }) : book
    ))
    const allBooks = this.data.allBooks.map((book) => (
      String(book.id || '') === failedId ? Object.assign({}, book, { coverUrl: '' }) : book
    ))

    this.setData({
      books,
      allBooks,
    })
  },
})
