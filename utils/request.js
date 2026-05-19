// 网络请求封装模块 - 提供统一的请求、响应处理和鉴权

const BASE_URL = 'https://yakosang.icu'

/** 拼接完整的请求 URL */
function buildUrl(url) {
  return `${BASE_URL}${url}`
}

/** 从响应对象中提取错误信息，生成标准 Error */
function normalizeError(res, fallbackMessage) {
  const data = res && res.data
  const error = new Error(
    (data && (data.error || data.message))
      || fallbackMessage
      || '请求失败'
  )
  if (data && typeof data === 'object') {
    error.code = data.code
    error.requestId = data.requestId
    error.details = data.details
  }
  return error
}

/** 解包后端通用响应格式 { success, data, message } */
function unwrapApiResponse(data, fallbackMessage) {
  if (!data || typeof data !== 'object' || typeof data.success === 'undefined') {
    return data || {}
  }

  if (data.success) {
    return data.data == null ? {} : data.data
  }

  const error = new Error(data.message || fallbackMessage || '请求失败')
  error.code = data.code
  error.requestId = data.requestId
  error.details = data.details
  throw error
}

/** 底层 wx.request 封装，处理状态码和异常 */
function rawRequest(options) {
  const requestUrl = buildUrl(options.url)

  return new Promise((resolve, reject) => {
    wx.request({
      url: requestUrl,
      method: options.method || 'GET',
      data: options.data || {},
      header: Object.assign({
        'Content-Type': 'application/json',
      }, options.header || {}),
      success: (res) => {
        console.info('[request] response', res.statusCode, requestUrl)
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(unwrapApiResponse(res.data || {}, '请求失败'))
          } catch (error) {
            error.statusCode = res.statusCode
            reject(error)
          }
          return
        }

        const error = normalizeError(res, '请求失败')
        error.statusCode = res.statusCode
        console.error('[request] bad response', requestUrl, res.statusCode, res.data || {})
        reject(error)
      },
      fail: (error) => {
        console.error('[request] failed', requestUrl, error)
        reject(error)
      },
    })
  })
}

/** 组装鉴权请求头 */
function getIdentityHeaders(identity, header) {
  if (!identity) {
    return header || {}
  }

  return Object.assign({
    Authorization: `Bearer ${identity.token}`,
    'X-Openid': identity.openid,
  }, header || {})
}

/** 带身份鉴权的请求 - 自动注入 token，401 时尝试重新鉴权 */
function request(options) {
  const { ensureUserIdentity } = require('../services/user')
  const { clearIdentity } = require('./storage')

  return ensureUserIdentity().then((identity) => {
    if (!identity || !identity.token || !identity.openid) {
      throw new Error('登录失败，请稍后重试')
    }

    return rawRequest(Object.assign({}, options, {
      header: getIdentityHeaders(identity, options.header),
    })).catch((error) => {
      const shouldRetryAuth = !options.__retriedAfterAuth
        && error
        && error.statusCode === 401

      if (!shouldRetryAuth) {
        throw error
      }

      clearIdentity()

      return request(Object.assign({}, options, {
        __retriedAfterAuth: true,
      }))
    })
  })
}

/** 无需鉴权的请求 */
function requestWithoutAuth(options) {
  return rawRequest(options)
}

/** 带鉴权的文件上传，401 时自动重试 */
function uploadFile(url, filePath, formData, hasRetriedAfterAuth) {
  const { ensureUserIdentity } = require('../services/user')
  const { clearIdentity } = require('./storage')

  return ensureUserIdentity().then((identity) => {
    if (!identity || !identity.token || !identity.openid) {
      throw new Error('登录失败，请稍后重试')
    }

    return new Promise((resolve, reject) => {
      wx.uploadFile({
        url: buildUrl(url),
        filePath,
        name: 'file',
        formData,
        header: getIdentityHeaders(identity),
        success: (res) => {
          let data = {}

          try {
            data = JSON.parse(res.data || '{}')
          } catch (error) {
            reject(error)
            return
          }

          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(unwrapApiResponse(data, '上传失败'))
            } catch (error) {
              error.statusCode = res.statusCode
              reject(error)
            }
            return
          }

          const error = new Error(data.error || data.message || '上传失败')
          error.statusCode = res.statusCode
          error.code = data.code
          error.requestId = data.requestId
          error.details = data.details
          reject(error)
        },
        fail: (error) => {
          reject(error)
        },
      })
    }).catch((error) => {
      const shouldRetryAuth = !hasRetriedAfterAuth
        && error
        && (
          error.statusCode === 401
          || String(error.message || '').indexOf('401') > -1
        )

      if (!shouldRetryAuth) {
        throw error
      }

      clearIdentity()

      return uploadFile(url, filePath, formData, true)
    })
  })
}

module.exports = {
  BASE_URL,
  unwrapApiResponse,
  request,
  requestWithoutAuth,
  uploadFile,
}
