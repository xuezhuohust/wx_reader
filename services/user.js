const { BASE_URL } = require('../utils/request')
const { getUserRole } = require('../utils/role')
const { loadIdentity, saveIdentity } = require('../utils/storage')

let bootstrapPromise = null

function getAppInstance() {
  try {
    return getApp()
  } catch (error) {
    return null
  }
}

function syncGlobalIdentity(identity) {
  const app = getAppInstance()
  if (app && app.globalData) {
    app.globalData.identity = identity || null
  }
}

function hasValidIdentity(identity) {
  return !!(
    identity
    && identity.userId
    && identity.openid
    && identity.token
  )
}

function getDefaultDisplayName(openid) {
  const suffix = String(openid || '').slice(-4) || '用户'
  return `微信用户 ${suffix}`
}

function getWxLoginCode() {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (res) => {
        if (res.code) {
          console.info('[auth] wx.login success')
          resolve(res.code)
          return
        }
        console.error('[auth] wx.login missing code', res)
        reject(new Error('未获取到微信登录 code'))
      },
      fail: (error) => {
        console.error('[auth] wx.login failed', error)
        reject(error)
      },
    })
  })
}

function callLoginApi(url, code) {
  return new Promise((resolve, reject) => {
    console.info('[auth] request login', `${BASE_URL}${url}`)
    wx.request({
      url: `${BASE_URL}${url}`,
      method: 'POST',
      data: { code },
      header: {
        'Content-Type': 'application/json',
      },
      success: (res) => {
        console.info('[auth] login response', res.statusCode, `${BASE_URL}${url}`)
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data || {})
          return
        }

        const error = new Error(
          (res.data && (res.data.error || res.data.message))
            || '登录失败'
        )
        error.statusCode = res.statusCode
        reject(error)
      },
      fail: (error) => {
        console.error('[auth] login request failed', `${BASE_URL}${url}`, error)
        reject(error)
      },
    })
  })
}

function loginWithWechat() {
  const previousIdentity = loadIdentity() || {}

  return getWxLoginCode()
    .then((code) => {
      return callLoginApi('/api/auth/login', code).catch((error) => {
        if (error && error.statusCode && error.statusCode !== 404) {
          throw error
        }
        return callLoginApi('/auth/login', code)
      })
    })
    .then((data) => {
      const openid = String(data.openid || '').trim()
      const token = String(data.token || '').trim()

      if (!openid || !token) {
        throw new Error('登录返回缺少身份信息')
      }

      const isSameUser = previousIdentity.openid === openid
      const displayName = isSameUser && String(previousIdentity.displayName || '').trim()
        ? String(previousIdentity.displayName || '').trim()
        : getDefaultDisplayName(openid)
      const avatarUrl = isSameUser ? (previousIdentity.avatarUrl || data.avatarUrl || '') : (data.avatarUrl || '')
      const roles = Array.isArray(data.roles) && data.roles.length ? data.roles : (previousIdentity.roles || ['reader'])
      const activeRole = String(data.activeRole || previousIdentity.activeRole || 'reader')

      return saveIdentity({
        userId: String(data.userId || openid),
        openid,
        token,
        roles,
        activeRole,
        role: activeRole,
        displayName,
        avatarUrl,
        updatedAt: Date.now(),
      })
    })
}

function bootstrapUserIdentity() {
  const cachedIdentity = loadIdentity()
  if (hasValidIdentity(cachedIdentity)) {
    syncGlobalIdentity(cachedIdentity)
    return Promise.resolve(cachedIdentity)
  }

  if (bootstrapPromise) {
    return bootstrapPromise
  }

  wx.showLoading({
    title: '登录中...',
    mask: true,
  })

  let loadingClosed = false
  const closeLoading = () => {
    if (loadingClosed) {
      return
    }
    loadingClosed = true
    wx.hideLoading()
  }

  bootstrapPromise = loginWithWechat()
    .then((identity) => {
      syncGlobalIdentity(identity)
      closeLoading()
      wx.showToast({
        title: '登录成功',
        icon: 'success',
      })
      return identity
    })
    .catch((error) => {
      console.error('bootstrapUserIdentity failed:', error)
      syncGlobalIdentity(null)
      closeLoading()
      wx.showToast({
        title: error.message || '登录失败',
        icon: 'none',
      })
      return null
    })
    .finally(() => {
      closeLoading()
      bootstrapPromise = null
    })

  return bootstrapPromise
}

function ensureUserIdentity() {
  const cachedIdentity = loadIdentity()
  if (hasValidIdentity(cachedIdentity)) {
    syncGlobalIdentity(cachedIdentity)
    return Promise.resolve(cachedIdentity)
  }

  return bootstrapUserIdentity()
}

function syncProfileIdentity(payload) {
  const { request } = require('../utils/request')

  return request({
    url: '/api/users/me/profile',
    method: 'PATCH',
    data: payload || {},
  }).then((data) => {
    const currentIdentity = loadIdentity() || {}
    const nextIdentity = saveIdentity(Object.assign({}, currentIdentity, data.identity || {}))
    syncGlobalIdentity(nextIdentity)
    return nextIdentity
  })
}

function switchActiveRole(role) {
  const { request } = require('../utils/request')

  return request({
    url: '/api/auth/switch-role',
    method: 'POST',
    data: { role },
  }).then((data) => {
    const currentIdentity = loadIdentity() || {}
    const nextIdentity = saveIdentity(Object.assign({}, currentIdentity, data.identity || {}))
    syncGlobalIdentity(nextIdentity)
    return nextIdentity
  })
}

module.exports = {
  getWxLoginCode,
  bootstrapUserIdentity,
  ensureUserIdentity,
  loginWithWechat,
  syncProfileIdentity,
  switchActiveRole,
}
