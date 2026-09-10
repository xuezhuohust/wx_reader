const api = require('../../utils/api')
const { syncRoleTabBar } = require('../../utils/tab-bar')

Page({
  data: {
    navBarHeight: 0,
    statusBarHeight: 0,
    menuTop: 0,
    menuHeight: 0,
    menuRight: 0,
    isLargeScreen: false,
    windowHeight: 0,
    books: [],
    allBooks: [],
    loading: true,
    searchValue: '',
    
    // Filters
    activeStatus: 'all',
    statusTabs: [
      { label: '全部', value: 'all' },
      { label: '在读', value: 'reading' },
      { label: '想读', value: 'wishlist' },
      { label: '已读', value: 'finished' }
    ],
    activeCategory: '全部',
    categories: ['全部'],
  },

  onLoad() {
    const app = getApp()
    const menuButtonInfo = wx.getMenuButtonBoundingClientRect()
    const layout = app.refreshLayout('bookshelf:onLoad')
    const systemInfo = layout.windowInfo
    
    this.setData({
      navBarHeight: app.globalData.navBarHeight,
      statusBarHeight: app.globalData.statusBarHeight,
      menuTop: menuButtonInfo.top,
      menuHeight: menuButtonInfo.height,
      menuRight: systemInfo.windowWidth - menuButtonInfo.left + 10,
      isLargeScreen: layout.isLandscapePad,
      windowHeight: layout.height,
    })
    this.loadBookCategories()
  },

  onResize(res) {
    const layout = getApp().refreshLayout('bookshelf:onResize', res && res.size)
    if (layout.isLandscapePad !== this.data.isLargeScreen) {
      this.setData({ isLargeScreen: layout.isLandscapePad, windowHeight: layout.height })
    } else if (layout.height !== this.data.windowHeight) {
      this.setData({ windowHeight: layout.height })
    }
    syncRoleTabBar(this, 'pages/bookshelf/bookshelf')
  },

  handleAppLayoutChange(size) {
    this.onResize({ size })
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

  loadBookCategories() {
    return api.getBookCategoryTabs()
      .then((categories) => {
        const activeCategory = categories.indexOf(this.data.activeCategory) >= 0
          ? this.data.activeCategory
          : '全部'
        this.setData({ categories, activeCategory }, () => {
          this.applyFilters()
        })
      })
      .catch((error) => {
        console.error('[bookshelf] loadBookCategories failed', error)
      })
  },

  loadBookshelf(done) {
    this.setData({ loading: true })
    const availableCategories = this.data.categories.filter((category) => category !== '全部')
    const allProgress = wx.getStorageSync('reading_progress') || {}

    api.getPurchasedBooks()
      .then((books) => {
        const processedBooks = (books || []).map(book => {
          const realProgress = allProgress[book.id] ? allProgress[book.id].bookProgress : null

          return Object.assign({}, book, {
            coverUrl: this.resolveCoverUrl(book),
            // Mocking some data for the UI if not present
            progress: realProgress !== null ? realProgress : (book.progress || 0),
            rating: book.rating || (4 + Math.random()).toFixed(1),
            readersCount: book.readersCount || Math.floor(Math.random() * 5000 + 100) + (Math.random() > 0.5 ? 'k' : ''),
            isAIReady: book.isAIReady !== undefined ? book.isAIReady : Math.random() > 0.5,
            status: book.status || ['reading', 'wishlist', 'finished'][Math.floor(Math.random() * 3)],
            category: book.category || availableCategories[Math.floor(Math.random() * availableCategories.length)] || ''
          })
        })
        this.setData({
          allBooks: processedBooks,
          loading: false,
        }, () => {
          this.applyFilters()
        })
      })
      .catch((error) => {
        console.error('[bookshelf] loadBookshelf failed', error)
        this.setData({ loading: false })
      })
      .finally(() => {
        if (typeof done === 'function') done()
      })
  },

  resolveCoverUrl(book) {
    const candidates = [book.coverUrl, book.cover_url, book.imageUrl, book.image_url, book.coverImage, book.cover_image]
    for (const c of candidates) {
      if (this.isImageCoverValue(c)) return api.toAbsoluteUrl(c)
    }
    if (this.isImageCoverValue(book.cover)) return api.toAbsoluteUrl(book.cover)
    return ''
  },

  isImageCoverValue(value) {
    const raw = String(value || '').trim()
    if (!raw) return false
    return /^(https?:\/\/|wxfile:\/\/|cloud:\/\/|data:image\/|\/)/.test(raw) || /\.(png|jpe?g|webp|gif|svg)(\?|#|$)/i.test(raw)
  },

  handleSearchInput(e) {
    this.setData({ searchValue: e.detail.value.toLowerCase() }, () => {
      this.applyFilters()
    })
  },

  handleStatusChange(e) {
    const { value } = e.currentTarget.dataset
    if (this.data.activeStatus === value) return
    this.setData({ activeStatus: value }, () => {
      this.applyFilters()
    })
  },

  handleCategoryChange(e) {
    const { value } = e.currentTarget.dataset
    if (this.data.activeCategory === value) return
    this.setData({ activeCategory: value }, () => {
      this.applyFilters()
    })
  },

  handleResetFilters() {
    this.setData({
      searchValue: '',
      activeStatus: 'all',
      activeCategory: '全部'
    }, () => {
      this.applyFilters()
    })
  },

  applyFilters() {
    const { allBooks, searchValue, activeStatus, activeCategory } = this.data
    
    let filtered = allBooks.filter(book => {
      // Search match
      const matchesSearch = !searchValue || 
        book.title.toLowerCase().includes(searchValue) || 
        (book.author && book.author.toLowerCase().includes(searchValue))
      
      // Status match
      const matchesStatus = activeStatus === 'all' || book.status === activeStatus
      
      // Category match
      const matchesCategory = activeCategory === '全部' || book.category === activeCategory
      
      return matchesSearch && matchesStatus && matchesCategory
    })
    
    this.setData({ books: filtered })
  },

  handleBookTap(e) {
    const { book } = e.currentTarget.dataset
    wx.navigateTo({
      url: `/pages/book-detail/book-detail?id=${book.id}`,
    })
  },

  onPullDownRefresh() {
    this.loadBookshelf(() => wx.stopPullDownRefresh())
  },

  onPageScroll() {
    // Keep for potential scroll-linked animations
  }
})
