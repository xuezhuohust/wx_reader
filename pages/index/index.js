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
    privacyModalTitle: '隐私授权说明',
    privacyModalText: '为提供完整伴读体验，小程序需要在您主动使用相关功能时调用录音、剪贴板、文件选择与图片选择能力，用于语音提问、复制消息、上传书籍和设置封面。请先阅读并同意隐私授权。',
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

    this.showInitialPrivacyAgreement()

    // Check for publisher build intent
  },

  showInitialPrivacyAgreement() {
    if (wx.getStorageSync('privacy_agreed')) {
      return
    }
    const tabBar = this.getTabBar && this.getTabBar()
    if (tabBar) tabBar.setHidden(true)
    this.setData({
      showPrivacyModal: true,
      privacyModalTitle: '隐私授权说明',
      privacyModalText: '为提供完整伴读体验，小程序需要在您主动使用相关功能时调用录音、剪贴板、文件选择与图片选择能力，用于语音提问、复制消息、上传书籍和设置封面。请先阅读并同意隐私授权。',
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
          '讲述英国青年鲁滨逊因海难流落荒岛28年，凭智慧与劳动自建家园、驯养动物、救下土著"星期五"，最终助船长平叛重返文明，歌颂人类在绝境中顽强求生与自我救赎的精神。',
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
    wx.setStorageSync('upload_file_privacy_agreed', true)
    wx.setStorageSync('upload_file_privacy_authorized_by_button', true)
    wx.setStorageSync('clipboard_privacy_agreed', true)
    this.setData({ showPrivacyModal: false })
    const tabBar = this.getTabBar && this.getTabBar()
    if (tabBar) tabBar.setHidden(false)
    getApp().resolvePrivacy(true, event)
  },

  handleDisagreePrivacy(event) {
    this.setData({ showPrivacyModal: false })
    const tabBar = this.getTabBar && this.getTabBar()
    if (tabBar) tabBar.setHidden(false)
    getApp().resolvePrivacy(false, event)
  },

  handleStopPropagation() {},

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
