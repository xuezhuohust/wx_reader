const api = require('../../utils/api')
const { ensureRole } = require('../../utils/role')
const { syncRoleTabBar } = require('../../utils/tab-bar')

Page({
  data: {
    searchValue: '',
    books: [],
    filteredBooks: [],
  },

  onShow() {
    if (!this.guardPublisherRole()) {
      return
    }
    syncRoleTabBar(this, 'pages/publisher/books')
    this.loadBooks()
  },

  loadBooks() {
    api.getPublisherBooks()
      .then((books) => {
        this.setData({ books })
        this.applyFilter(books, this.data.searchValue)
      })
      .catch((error) => {
        console.error('loadPublisherBooks failed:', error)
        this.setData({
          books: [],
          filteredBooks: [],
        })
      })
  },

  applyFilter(books, keyword) {
    const searchText = String(keyword || '').trim().toLowerCase()
    const filteredBooks = (books || []).filter((item) => {
      return !searchText
        || item.title.toLowerCase().indexOf(searchText) > -1
        || item.author.toLowerCase().indexOf(searchText) > -1
        || item.category.toLowerCase().indexOf(searchText) > -1
    })
    this.setData({ filteredBooks })
  },

  handleSearchInput(event) {
    const searchValue = event.detail.value
    this.setData({ searchValue })
    this.applyFilter(this.data.books, searchValue)
  },

  handleBookTap(event) {
    const { id } = event.currentTarget.dataset
    wx.navigateTo({
      url: `/pages/book-detail/book-detail?id=${id}&scene=publisher`,
    })
  },

  handleToggleStatus(event) {
    const { id, status } = event.currentTarget.dataset
    const current = this.data.books.find((item) => item.id === id)
    if (!current) {
      return
    }

    if (current.buildStatus !== 'done') {
      wx.showToast({
        title: '请先完成建库',
        icon: 'none',
      })
      return
    }

    const nextStatus = status === 'online' ? 'offline' : 'online'
    api.updateBookOnlineStatus(id, nextStatus)
      .then(() => {
        wx.showToast({
          title: nextStatus === 'online' ? '已上架' : '已下架',
          icon: 'success',
        })
        this.loadBooks()
      })
      .catch((error) => {
        wx.showToast({
          title: error.message || '操作失败',
          icon: 'none',
        })
      })
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
