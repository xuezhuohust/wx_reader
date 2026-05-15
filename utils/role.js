const { loadIdentity, saveIdentity } = require('./storage')

function getUserRole(identity) {
  if (identity && (identity.activeRole === 'publisher' || identity.role === 'publisher')) {
    return 'publisher'
  }
  return 'reader'
}

function getRoleLabel(role) {
  return role === 'publisher' ? '出版模式' : '智读模式'
}

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
