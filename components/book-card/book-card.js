const {
  formatPrice,
  formatRelativeReadTime,
  getBuildStatusMeta,
  getOnlineStatusMeta,
  getPurchaseStatusMeta,
} = require('../../utils/format')

Component({
  properties: {
    book: {
      type: Object,
      value: null,
    },
    mode: {
      type: String,
      value: 'market',
    },
  },

  data: {
    priceText: '',
    readTimeText: '',
    actionText: '',
    coverTheme: '',
    coverInitial: '书',
    buildMeta: {},
    onlineMeta: {},
    purchaseMeta: {},
  },

  observers: {
    'book,mode': function (book, mode) {
      if (!book) {
        return
      }
      this.syncView(book, mode)
    },
  },

  lifetimes: {
    attached() {
      if (this.data.book) {
        this.syncView(this.data.book, this.data.mode)
      }
    },
  },

  methods: {
    syncView(book, mode) {
      this.setData({
        priceText: formatPrice(book.price),
        readTimeText: formatRelativeReadTime(book.lastReadAt),
        actionText: mode === 'owned' ? '继续对话' : (book.purchased ? '进入阅读' : '购买'),
        coverTheme: book.cover || 'cover-sunset',
        coverInitial: book.title ? book.title.slice(0, 1) : '书',
        buildMeta: getBuildStatusMeta(book.buildStatus),
        onlineMeta: getOnlineStatusMeta(book.onlineStatus),
        purchaseMeta: getPurchaseStatusMeta(book.purchased),
      })
    },

    handleTap() {
      this.triggerEvent('cardtap', { book: this.data.book })
    },

    handleAction() {
      this.triggerEvent('actiontap', { book: this.data.book })
    },
  },
})
