const { loadIdentity } = require('./storage')
const { getUserRole } = require('./role')

const ICONS = {
  bookshelf: 'data:image/svg+xml,<svg viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"></path><path d="M6.5 17H20"></path></svg>',
  home: 'data:image/svg+xml,<svg viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>',
  user: 'data:image/svg+xml,<svg viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>',
  management: 'data:image/svg+xml,<svg viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>',
  dashboard: 'data:image/svg+xml,<svg viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"></path><path d="M22 12A10 10 0 0 0 12 2v10z"></path></svg>',
  build: 'data:image/svg+xml,<svg viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line></svg>',
}

const READER_TAB_ITEMS = [
  {
    pagePath: 'pages/bookshelf/bookshelf',
    text: '书架',
    iconPath: ICONS.bookshelf,
    selectedIconPath: ICONS.bookshelf,
  },
  {
    pagePath: 'pages/index/index',
    text: '首页',
    iconPath: ICONS.home,
    selectedIconPath: ICONS.home,
  },
  {
    pagePath: 'pages/my-books/my-books',
    text: '我的',
    iconPath: ICONS.user,
    selectedIconPath: ICONS.user,
  },
]

const PUBLISHER_TAB_ITEMS = [
  {
    pagePath: 'pages/publisher/books',
    text: '管理',
    iconPath: ICONS.management,
    selectedIconPath: ICONS.management,
  },
  {
    pagePath: 'pages/publisher/index',
    text: '仪表盘',
    iconPath: ICONS.dashboard,
    selectedIconPath: ICONS.dashboard,
  },
  {
    pagePath: 'pages/my-books/my-books',
    text: '我的',
    iconPath: ICONS.user,
    selectedIconPath: ICONS.user,
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
