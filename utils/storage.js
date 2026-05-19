// 本地存储管理模块 - 用户身份信息的存取与清除

/** 本地存储中用户身份信息对应的 key */
const IDENTITY_STORAGE_KEY = 'user_identity'

/** 获取全局 App 实例 */
function getAppInstance() {
  try {
    return getApp()
  } catch (error) {
    return null
  }
}

/** 从本地存储加载用户身份信息 */
function loadIdentity() {
  const identity = wx.getStorageSync(IDENTITY_STORAGE_KEY)
  if (!identity || typeof identity !== 'object') {
    return null
  }
  return identity
}

/** 保存用户身份信息到本地存储，并同步到全局数据 */
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

/** 清除本地存储及全局数据中的用户身份信息 */
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
