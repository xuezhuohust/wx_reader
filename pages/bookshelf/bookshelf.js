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
    const isScrolled = e.scrollTop > 50
    if (isScrolled !== this.data.scrolled) {
      this.setData({
        scrolled: isScrolled,
      })
    }
  },

  onShow() {
    syncRoleTabBar(this, 'pages/bookshelf/bookshelf')
    this.loadBookshelf()
  },

  onPullDownRefresh() {
    this.loadBookshelf(() => {
      wx.stopPullDownRefresh()
    })
  },

  loadBookshelf(done) {
    this.setData({ loading: true })
    api.getPurchasedBooks()
      .then((books) => {
        // 确保封面 URL 是绝对路径
        const processedBooks = (books || []).map(book => {
          const rawCover = book.coverUrl || book.cover
          return Object.assign({}, book, {
            coverUrl: rawCover ? api.toAbsoluteUrl(rawCover) : 'https://mp-8bdc7c18-cba4-4488-8c57-e587ac252b55.cdn.bspapp.com/fengmian.png'
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
    const { index } = e.currentTarget.dataset
    const { books } = this.data
    const defaultCover = 'https://mp-8bdc7c18-cba4-4488-8c57-e587ac252b55.cdn.bspapp.com/fengmian.png'
    
    if (books[index] && books[index].coverUrl !== defaultCover) {
      const key = `books[${index}].coverUrl`
      this.setData({
        [key]: defaultCover
      })
    }
  },
})
