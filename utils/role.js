// 用户角色管理模块 - 判断与切换读者/出版者身份

const { loadIdentity, saveIdentity } = require('./storage')

/** 获取当前用户的角色（reader / publisher） */
function getUserRole(identity) {
  if (identity && (identity.activeRole === 'publisher' || identity.role === 'publisher')) {
    return 'publisher'
  }
  return 'reader'
}

/** 获取角色对应的中文显示标签 */
function getRoleLabel(role) {
  return role === 'publisher' ? '出版模式' : '智读模式'
}

/** 更新用户角色并持久化 */
function updateIdentityRole(role) {
  const identity = loadIdentity()
  if (!identity) {
    return null
  }

  const nextRole = role === 'publisher' ? 'publisher' : 'reader'
  return saveIdentity(Object.assign({}, identity, {
    activeRole: nextRole,
    role: nextRole,
  }))
}

/** 检查当前用户是否为指定角色 */
function ensureRole(requiredRole) {
  const identity = loadIdentity()
  return getUserRole(identity) === requiredRole
}

module.exports = {
  ensureRole,
  getRoleLabel,
  getUserRole,
  updateIdentityRole,
}
