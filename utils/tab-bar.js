const { loadIdentity } = require('./storage')
const { getUserRole } = require('./role')

const SHARED_ICON = {
  iconPath: '/app-assets/tab-default.png',
  selectedIconPath: '/app-assets/tab-active.png',
}

const READER_TAB_ITEMS = [
  {
    pagePath: 'pages/index/index',
    text: '首页',
    iconPath: SHARED_ICON.iconPath,
    selectedIconPath: SHARED_ICON.selectedIconPath,
  },
  {
    pagePath: 'pages/my-books/my-books',
    text: '我的',
    iconPath: SHARED_ICON.iconPath,
    selectedIconPath: SHARED_ICON.selectedIconPath,
  },
]

const PUBLISHER_TAB_ITEMS = [
  {
    pagePath: 'pages/index/index',
    text: '工作台',
    iconPath: SHARED_ICON.iconPath,
    selectedIconPath: SHARED_ICON.selectedIconPath,
  },
  {
    pagePath: 'pages/publisher/books',
    text: '书目',
    iconPath: SHARED_ICON.iconPath,
    selectedIconPath: SHARED_ICON.selectedIconPath,
  },
  {
    pagePath: 'pages/publisher/build',
    text: '建库',
    iconPath: SHARED_ICON.iconPath,
    selectedIconPath: SHARED_ICON.selectedIconPath,
  },
]

function getAppInstance() {
  try {
    return getApp()
  } catch (error) {
    return null
  }
}

function normalizePagePath(path) {
  return String(path || '').replace(/^\//, '')
}

function getTabsByRole(role) {
  const source = role === 'publisher' ? PUBLISHER_TAB_ITEMS : READER_TAB_ITEMS
  return source.map((item) => Object.assign({}, item))
}

function resolveIdentity(identity) {
  if (identity) {
    return identity
  }

  const app = getAppInstance()
  if (app && app.globalData && app.globalData.identity) {
    return app.globalData.identity
  }

  return loadIdentity()
}

function syncRoleTabBar(page, pagePath, identity) {
  if (!page || typeof page.getTabBar !== 'function') {
    return
  }

  const tabBar = page.getTabBar()
  if (!tabBar || typeof tabBar.setData !== 'function') {
    return
  }

  const nextIdentity = resolveIdentity(identity)
  const role = getUserRole(nextIdentity)

  tabBar.setData({
    currentRole: role,
    items: getTabsByRole(role),
    selectedPath: normalizePagePath(pagePath || page.route),
  })
}

module.exports = {
  getTabsByRole,
  syncRoleTabBar,
}
