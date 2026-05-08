Component({
  properties: {
    title: {
      type: String,
      value: '暂无内容',
    },
    description: {
      type: String,
      value: '换个条件试试看',
    },
    buttonText: {
      type: String,
      value: '',
    },
  },

  methods: {
    handleAction() {
      this.triggerEvent('actiontap')
    },
  },
})
