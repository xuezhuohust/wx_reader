const api = require('../../utils/api')
const { bootstrapUserIdentity, switchActiveRole } = require('../../services/user')
const { getRoleLabel, getUserRole, updateIdentityRole } = require('../../utils/role')
const { syncRoleTabBar } = require('../../utils/tab-bar')

Page({
  data: {
    loading: true, // Add loading state
    keyword: '',
    recommendBooks: [],
    identity: null,
    publisher: null,
    publisherStats: {},
    currentRole: 'reader',
    currentRoleLabel: '读者',
    showPermissionModal: false,
    showPrivacyModal: false,
    navBarHeight: getApp().globalData.navBarHeight,
    statusBarHeight: getApp().globalData.statusBarHeight,
    menuRight: getApp().globalData.menuRight,
    menuTop: getApp().globalData.menuTop,
    menuHeight: getApp().globalData.menuHeight,
    menuWidth: 87, // Default width
    // Library Data
    searchValue: '',
    activeCategory: '全部',
    categories: ['全部', '文学', '科技', '经管', '教育', '武侠', '科幻', '历史', '悬疑'],
    books: [],
    filteredBooks: [],
    searchResultBooks: [],
    showSearchDrawer: false,
    loadError: false,
    scrolled: false,
    publisherEntries: [
      {
        title: '书目管理',
        desc: '搜索、上下架与查看详情',
        path: '/pages/publisher/books',
        type: 'tab',
      },
      {
        title: '上传书籍',
        desc: '录入书目并上传源文件',
        path: '/pages/publisher/upload',
        type: 'page',
      },
      {
        title: '建库任务',
        desc: '启动建库并查看进度',
        path: '/pages/publisher/build',
        type: 'tab',
      },
    ],
  },

  onLoad(options) {
    const app = getApp()
    this.setData({
      navBarHeight: app.globalData.navBarHeight,
      statusBarHeight: app.globalData.statusBarHeight,
      menuRight: app.globalData.menuRight,
      menuTop: app.globalData.menuTop,
      menuHeight: app.globalData.menuHeight,
      menuWidth: app.globalData.menuWidth,
    })

    // Check for publisher build intent
  },

  onPageScroll(e) {
    const isScrolled = e.scrollTop > 50
    if (isScrolled !== this.data.scrolled) {
      this.setData({
        scrolled: isScrolled,
      })
    }
  },

  handleExplore() {
    wx.pageScrollTo({
      selector: '.main-content',
      duration: 300,
    })
  },

  onShow() {
    const { getUserRole } = require('../../utils/role')
    const { loadIdentity } = require('../../utils/storage')
    const identity = loadIdentity()
    const role = getUserRole(identity)
    
    if (role === 'publisher') {
      wx.switchTab({
        url: '/pages/publisher/index',
      })
      return
    }

    syncRoleTabBar(this, 'pages/index/index')
    this.bootstrapHome()

    const app = getApp()
    const keyword = app.globalData.libraryKeyword
    if (typeof keyword === 'string' && keyword) {
      this.setData({
        searchValue: keyword,
      })
      app.globalData.libraryKeyword = ''
      if (this.data.books.length > 0) {
        this.applyFilters(this.data.books, keyword, this.data.activeCategory)
      }
    }

    this.setData({
      scrolled: false,
    })
  },

  onPullDownRefresh() {
    const done = () => {
      wx.stopPullDownRefresh()
    }

    if (this.data.currentRole === 'publisher') {
      this.loadPublisherStats(done)
      return
    }

    Promise.all([
      this.loadRecommendBooks(),
      this.loadLibraryBooks(),
    ]).finally(() => {
      done()
    })
  },

  bootstrapHome() {
    if (this.bootstrapting) {
      return
    }

    this.bootstrapting = true
    this.setData({ loading: true }) // Ensure loading is true when starting

    bootstrapUserIdentity()
      .then((identity) => {
        this._enterMain(identity)
        if (!identity) {
          this.setData({
            recommendBooks: [],
            publisher: null,
            publisherStats: {},
            loading: false, // Stop loading if no identity
          })
          return null
        }

        return this.loadRoleContent(identity)
      })
      .then(() => {
        this.setData({ loading: false }) // Stop loading after content is loaded
      })
      .catch(() => {
        this.setData({ loading: false }) // Stop loading on error
      })
      .finally(() => {
        this.bootstrapting = false
      })
  },

  _enterMain(identity) {
    const currentRole = getUserRole(identity)

    this.setData({
      identity: identity || null,
      currentRole,
      currentRoleLabel: getRoleLabel(currentRole),
      showPermissionModal: !wx.getStorageSync('permission_notified'),
    })
    this.syncTabBar(identity)
  },

  syncTabBar(identity) {
    syncRoleTabBar(this, 'pages/index/index', identity)
  },

  handleProfileTap() {
    wx.switchTab({
      url: '/pages/my-books/my-books',
    })
  },

  loadRoleContent(identity) {
    if (getUserRole(identity) === 'publisher') {
      return this.loadPublisherStats()
    }

    const app = getApp()
    const cache = app.globalData.homeCache
    const now = Date.now()

    // Use cache if it's fresh (within 5 minutes)
    if (cache.recommendBooks && cache.libraryBooks && (now - cache.lastUpdated < 5 * 60 * 1000)) {
      this.setData({
        recommendBooks: cache.recommendBooks,
        books: cache.libraryBooks,
        loading: false,
      })
      this.applyFilters(cache.libraryBooks, this.data.searchValue, this.data.activeCategory)
      
      // Still refresh in background to keep data fresh
      Promise.all([
        this.loadRecommendBooks(),
        this.loadLibraryBooks(),
      ])
      return Promise.resolve()
    }

    return Promise.all([
      this.loadRecommendBooks(),
      this.loadLibraryBooks(),
    ])
  },

  loadRecommendBooks(done) {
    return api.getRecommendBooks()
      .then((recommendBooks) => {
        const app = getApp()
        
        // Enhance with mock AI reasons if missing
        const reasons = [
          '这本书情节跌宕，适合深度思考',
          '文笔细腻，带你领略不一样的世界',
          'AI 认为这本书的逻辑架构非常严谨',
          '这本书在社交媒体上引发了广泛讨论',
          '适合在安静的午后阅读，启发灵感',
          '深度剖析人性，值得反复品味'
        ]
        
        const enhancedBooks = (recommendBooks || []).map((book, index) => ({
          ...book,
          recommendReason: book.recommendReason || reasons[index % reasons.length]
        }))

        app.globalData.homeCache.recommendBooks = enhancedBooks
        app.globalData.homeCache.lastUpdated = Date.now()
        
        this.setData({
          recommendBooks: enhancedBooks,
          loadError: false,
        })
      })
      .catch((error) => {
        console.error('loadRecommendBooks failed:', error)
        this.setData({
          recommendBooks: [],
          loadError: true,
        })
      })
      .finally(() => {
        if (typeof done === 'function') {
          done()
        }
      })
  },

  loadLibraryBooks(done) {
    return api.getAllBooks()
      .then((books) => {
        const app = getApp()
        app.globalData.homeCache.libraryBooks = books
        app.globalData.homeCache.lastUpdated = Date.now()

        this.setData({
          books,
          loadError: false,
        })
        this.applyFilters(books, this.data.searchValue, this.data.activeCategory)
      })
      .catch((error) => {
        console.error('loadLibraryBooks failed:', error)
        this.setData({
          books: [],
          filteredBooks: [],
          loadError: true,
        })
      })
      .finally(() => {
        if (typeof done === 'function') {
          done()
        }
      })
  },

  handleKeywordInput(event) {
    const searchValue = event.detail.value
    this.setData({ searchValue })
    
    // 如果清空了搜索框，收起抽屉
    if (!searchValue.trim()) {
      this.setData({ 
        showSearchDrawer: false,
        searchResultBooks: [] 
      })
    }
  },

  handleSearch() {
    const keyword = this.data.searchValue.trim()
    if (keyword) {
      const searchResultBooks = this.filterByKeyword(this.data.books, keyword)
      this.setData({ 
        searchResultBooks,
        showSearchDrawer: true 
      })
    }
  },

  filterByKeyword(books, keyword) {
    const searchText = String(keyword || '').trim().toLowerCase()
    if (!searchText) return []
    
    return (books || []).filter((item) => {
      return item.title.toLowerCase().indexOf(searchText) > -1
        || item.author.toLowerCase().indexOf(searchText) > -1
        || item.description.toLowerCase().indexOf(searchText) > -1
    })
  },

  closeSearchDrawer() {
    this.setData({ showSearchDrawer: false })
  },

  applyFilters(books, keyword, category) {
    const filteredBooks = (books || []).filter((item) => {
      const matchedCategory = category === '全部' || item.category === category
      return matchedCategory
    })

    this.setData({
      filteredBooks,
    })
  },

  loadPublisherStats(done) {
    return api.getPublisherStats()
      .then((res) => {
        this.setData({
          publisher: res.publisher || null,
          publisherStats: res || {},
        })
      })
      .catch((error) => {
        console.error('loadPublisherStats failed:', error)
        this.setData({
          publisher: null,
          publisherStats: {},
        })
      })
      .finally(() => {
        if (typeof done === 'function') {
          done()
        }
      })
  },

  handleTabChange(event) {
    const activeCategory = event.currentTarget.dataset.value
    this.setData({ activeCategory })
    this.applyFilters(this.data.books, this.data.searchValue, activeCategory)
  },

  handleBookTap(event) {
    const { book } = event.detail
    wx.navigateTo({
      url: `/pages/book-detail/book-detail?id=${book.id}`,
    })
  },

  handleActionTap(event) {
    const { book } = event.detail
    wx.navigateTo({
      url: `/pages/book-detail/book-detail?id=${book.id}`,
    })
  },

  handleRecommendTap(event) {
    const { id } = event.currentTarget.dataset

    this.switchRole('reader')
      .then(() => {
        wx.navigateTo({
          url: `/pages/book-detail/book-detail?id=${id}`,
        })
      })
      .catch(() => null)
  },

  handlePublisherActionTap(event) {
    const { path, type } = event.currentTarget.dataset

    this.switchRole('publisher')
      .then(() => {
        if (type === 'tab') {
          wx.switchTab({ url: path })
          return
        }

        wx.navigateTo({ url: path })
      })
      .catch(() => null)
  },

  handleRoleChange(event) {
    const { role } = event.currentTarget.dataset
    this.switchRole(role)
  },

  switchRole(role, targetUrl) {
    const app = getApp()
    const currentIdentity = this.data.identity || app.globalData.identity

    if (getUserRole(currentIdentity) === role) {
      this._enterMain(currentIdentity)
      return this.loadRoleContent(currentIdentity)
        .then(() => {
          if (targetUrl) {
            wx.switchTab({ url: targetUrl })
          }
          return currentIdentity
        })
    }

    return switchActiveRole(role)
      .then((nextIdentity) => {
        const fallbackIdentity = updateIdentityRole(role)
        const identity = nextIdentity || fallbackIdentity || this.data.identity

        this._enterMain(identity)
        return this.loadRoleContent(identity)
          .then(() => {
            if (targetUrl) {
              wx.switchTab({ url: targetUrl })
            }
            return identity
          })
      })
      .catch((error) => {
        console.error('switchRole failed:', error)
        wx.showToast({
          title: error.message || '切换失败',
          icon: 'none',
        })
        throw error
      })
  },

  showPrivacyPopup() {
    this.setData({ showPrivacyModal: true })
  },

  handleAgreePrivacy(event) {
    wx.setStorageSync('privacy_agreed', true)
    wx.setStorageSync('privacy_authorized_by_button', true)
    this.setData({ showPrivacyModal: false })
    getApp().resolvePrivacy(true, event)
  },

  handleDisagreePrivacy(event) {
    this.setData({ showPrivacyModal: false })
    getApp().resolvePrivacy(false, event)
  },

  handleClosePermission() {
    this.setData({
      showPermissionModal: false,
    })
    wx.setStorageSync('permission_notified', true)
    
    // Request microphone permission proactively
    wx.authorize({
      scope: 'scope.record',
      success() {
        console.log('Microphone permission granted')
      },
      fail() {
        console.log('Microphone permission denied')
      }
    })
  },

  handleStopPropagation() {},
})
