Component({
  data: {
    currentRole: 'reader',
    items: [],
    selectedPath: '',
    hidden: false,
    isLargeScreen: false,
  },

  methods: {
    setHidden(hidden) {
      this.setData({ hidden: !!hidden })
    },

    handleTabTap(event) {
      const path = String(event.currentTarget.dataset.path || '')
      const normalizedPath = path.replace(/^\//, '')

      if (!normalizedPath || normalizedPath === this.data.selectedPath) {
        return
      }

      wx.switchTab({
        url: `/${normalizedPath}`,
      })
    },
  },
})
