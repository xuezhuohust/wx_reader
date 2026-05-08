const { getBuildStatusMeta, getOnlineStatusMeta, getPurchaseStatusMeta } = require('../../utils/format')

Component({
  properties: {
    type: {
      type: String,
      value: '',
    },
    status: {
      type: String,
      optionalTypes: [Boolean, Number],
      value: '',
    },
    text: {
      type: String,
      value: '',
    },
    theme: {
      type: String,
      value: '',
    },
  },

  data: {
    currentText: '',
    currentTheme: 'neutral',
  },

  observers: {
    'type,status,text,theme': function () {
      this.syncMeta()
    },
  },

  lifetimes: {
    attached() {
      this.syncMeta()
    },
  },

  methods: {
    syncMeta() {
      const { type, status, text, theme } = this.data
      let meta = { text: text || '', theme: theme || 'neutral' }

      if (type === 'build') {
        meta = getBuildStatusMeta(status)
      } else if (type === 'online') {
        meta = getOnlineStatusMeta(status)
      } else if (type === 'purchase') {
        meta = getPurchaseStatusMeta(status)
      } else if (text) {
        meta = { text, theme: theme || 'neutral' }
      }

      this.setData({
        currentText: meta.text,
        currentTheme: meta.theme,
      })
    },
  },
})
