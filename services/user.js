// 用户身份服务模块 - 处理微信登录、身份缓存、角色切换

const { BASE_URL, unwrapApiResponse } = require('../utils/request')
const { loadIdentity, saveIdentity } = require('../utils/storage')

/** 引导登录过程中缓存的 Promise，防止重复发起 */
let bootstrapPromise = null

/** 获取全局 App 实例 */
function getAppInstance() {
  try {
    return getApp()
  } catch (error) {
    return null
  }
}

/** 将身份信息同步到全局数据 */
function syncGlobalIdentity(identity) {
  const app = getAppInstance()
  if (app && app.globalData) {
    app.globalData.identity = identity || null
  }
}

/** 检查身份信息是否完整有效 */
function hasValidIdentity(identity) {
  return !!(
    identity
    && identity.userId
    && identity.openid
    && identity.token
  )
}

/** 根据 openid 生成默认显示名称 */
function getDefaultDisplayName(openid) {
  const suffix = String(openid || '').slice(-4) || '用户'
  return `微信用户 ${suffix}`
}

/** 调用 wx.login 获取临时 code */
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

/** 请求登录接口兑换身份信息 */
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
          try {
            resolve(unwrapApiResponse(res.data || {}, '登录失败'))
          } catch (error) {
            error.statusCode = res.statusCode
            reject(error)
          }
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

/** 微信登录 - 获取 code 后请求后端，保存身份信息到本地存储 */
function loginWithWechat() {
  const previousIdentity = loadIdentity() || {}

  return getWxLoginCode()
    .then((code) => {
      // 优先新版 API，fallback 到旧版
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

      // 同一用户复用之前的 displayName / avatarUrl
      const isSameUser = previousIdentity.openid === openid
      const displayName = isSameUser && String(previousIdentity.displayName || '').trim()
        ? String(previousIdentity.displayName || '').trim()
        : (String(data.displayName || '').trim() || getDefaultDisplayName(openid))
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
        profileCompleted: !!data.profileCompleted,
        phoneBound: !!data.phoneBound,
        updatedAt: Date.now(),
      })
    })
}

/** 引导登录流程 - 有缓存则直接返回，否则调用微信登录并显示 loading */
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

/** 确保用户已登录，返回身份信息；未登录则自动发起引导登录 */
function ensureUserIdentity() {
  const cachedIdentity = loadIdentity()
  if (hasValidIdentity(cachedIdentity)) {
    syncGlobalIdentity(cachedIdentity)
    return Promise.resolve(cachedIdentity)
  }

  return bootstrapUserIdentity()
}

/** 更新用户资料并同步到本地存储 */
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

/** 切换用户活跃角色（reader / publisher） */
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
