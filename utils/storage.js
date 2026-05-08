const IDENTITY_STORAGE_KEY = 'reader_user_identity'

function getAppInstance() {
  try {
    return getApp()
  } catch (error) {
    return null
  }
}

function loadIdentity() {
  const identity = wx.getStorageSync(IDENTITY_STORAGE_KEY)
  if (!identity || typeof identity !== 'object') {
    return null
  }
  return identity
}

function saveIdentity(identity) {
  if (!identity || typeof identity !== 'object') {
    return null
  }

  const nextIdentity = Object.assign({}, identity, {
    updatedAt: Date.now(),
  })

  wx.setStorageSync(IDENTITY_STORAGE_KEY, nextIdentity)

  const app = getAppInstance()
  if (app && app.globalData) {
    app.globalData.identity = nextIdentity
  }

  return nextIdentity
}

function clearIdentity() {
  wx.removeStorageSync(IDENTITY_STORAGE_KEY)

  const app = getAppInstance()
  if (app && app.globalData) {
    app.globalData.identity = null
  }
}

module.exports = {
  clearIdentity,
  loadIdentity,
  saveIdentity,
}
