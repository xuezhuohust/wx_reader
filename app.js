const { loadIdentity } = require('./utils/storage')

App({
  globalData: {
    libraryKeyword: '',
    identity: null,
    publisherBuildIntent: null,
  },

  onLaunch() {
    this.globalData.identity = loadIdentity()
  },
})
