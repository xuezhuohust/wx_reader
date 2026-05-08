const { loadIdentity, saveIdentity } = require('./storage')

function getUserRole(identity) {
  if (identity && identity.activeRole === 'publisher') {
    return 'publisher'
  }
  if (identity && identity.role === 'publisher') {
    return 'publisher'
  }
  return 'reader'
}

function getRoleLabel(role) {
  return role === 'publisher' ? '出版社' : '读者'
}

function updateIdentityRole(role) {
  const identity = loadIdentity()
  if (!identity) {
    return null
  }

  return saveIdentity(Object.assign({}, identity, {
    activeRole: getUserRole({ activeRole: role }),
    role: getUserRole({ role }),
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
