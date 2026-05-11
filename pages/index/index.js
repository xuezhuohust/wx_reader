const api = require('../../utils/api')
const { bootstrapUserIdentity, switchActiveRole } = require('../../services/user')
const { getRoleLabel, getUserRole, updateIdentityRole } = require('../../utils/role')
const { syncRoleTabBar } = require('../../utils/tab-bar')

Page({
  data: {
    keyword: '',
    recommendBooks: [],
    identity: null,
    publisher: null,
    publisherStats: {},
    currentRole: 'reader',
    currentRoleLabel: '读者',
    showPermissionModal: false,
    navBarHeight: getApp().globalData.navBarHeight,
    statusBarHeight: getApp().globalData.statusBarHeight,
    menuRight: getApp().globalData.menuRight,
    menuTop: getApp().globalData.menuTop,
    menuHeight: getApp().globalData.menuHeight,
    menuWidth: 87, // Default width
    // Library Data
    searchValue: '',
    activeCategory: '全部',
    categories: ['全部', '文学', '科技', '经管', '教育'],
    books: [],
    filteredBooks: [],
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
    this.syncTabBar()
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

    bootstrapUserIdentity()
      .then((identity) => {
        this._enterMain(identity)
        if (!identity) {
          this.setData({
            recommendBooks: [],
            publisher: null,
            publisherStats: {},
          })
          return null
        }

        return this.loadRoleContent(identity)
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

    return Promise.all([
      this.loadRecommendBooks(),
      this.loadLibraryBooks(),
    ])
  },

  loadRecommendBooks(done) {
    return api.getRecommendBooks()
      .then((recommendBooks) => {
        this.setData({
          recommendBooks,
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

  applyFilters(books, keyword, category) {
    const searchText = String(keyword || '').trim().toLowerCase()
    const filteredBooks = (books || []).filter((item) => {
      const matchedCategory = category === '全部' || item.category === category
      const matchedKeyword = !searchText
        || item.title.toLowerCase().indexOf(searchText) > -1
        || item.author.toLowerCase().indexOf(searchText) > -1
        || item.description.toLowerCase().indexOf(searchText) > -1
      return matchedCategory && matchedKeyword
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

  handleKeywordInput(event) {
    const searchValue = event.detail.value
    this.setData({ searchValue })
    this.applyFilters(this.data.books, searchValue, this.data.activeCategory)
  },

  handleSearch() {
    this.applyFilters(this.data.books, this.data.searchValue, this.data.activeCategory)
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

  handleClosePermission() {
    this.setData({
      showPermissionModal: false,
    })
    wx.setStorageSync('permission_notified', true)
  },

  handleStopPropagation() {},
})
