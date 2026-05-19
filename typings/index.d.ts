// 项目全局类型定义

/// <reference path="./types/index.d.ts" />

/** 小程序 App 构造器的选项类型 */
interface IAppOption {
  globalData: {
    userInfo?: WechatMiniprogram.UserInfo,
  }
  userInfoReadyCallback?: WechatMiniprogram.GetUserInfoSuccessCallback,
}