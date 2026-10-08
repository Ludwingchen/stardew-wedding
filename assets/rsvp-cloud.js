/*!
 * 宾客登记 · 云端适配层
 * 把邀请函的「确认赴约」表单与后台「宾客登记簿」接到 WorkBuddy 云服务。
 * 依赖：assets/vendor/workbuddy-cloud-sdk.js（本地优先，缺失时自动回退 CDN）
 * 暴露：window.WBRSVP
 */
(function () {
  "use strict";

  /* publicConfig —— 开通云服务时下发，可安全放在前端 */
  var CONFIG = {
    endpoint: "https://stardew-wedding-invite-18815.app.workbuddy.host",
    oauthRelayBaseUrl: "https://www.workbuddy.cn/v2/as/genie-baas/oauth",
    publishableKey: "wbpk_IIdeSQJv7SaYWypFinkXMK_kFsCDDvsZY02vqWM9yAGecF1GRkNw2Ev"
  };

  var CDN_SDK = "https://cdn.jsdelivr.net/npm/@tencent-ai/workbuddy-cloud-sdk@dev/lib/index.global.js";
  var SESSION_KEY = "stardew-wedding-admin-key";

  var client = null;
  var loading = null;

  function sdkReady() {
    return !!(window.WorkBuddyCloud && window.WorkBuddyCloud.createWorkBuddyCloud);
  }

  function loadSdk() {
    if (sdkReady()) return Promise.resolve();
    if (loading) return loading;
    loading = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = CDN_SDK;
      s.async = true;
      s.onload = function () { sdkReady() ? resolve() : reject(new Error("SDK_INIT")); };
      s.onerror = function () { reject(new Error("SDK_LOAD")); };
      document.head.appendChild(s);
      setTimeout(function () { sdkReady() ? resolve() : reject(new Error("SDK_TIMEOUT")); }, 15000);
    });
    return loading;
  }

  function getClient() {
    if (client) return Promise.resolve(client);
    return loadSdk().then(function () {
      client = window.WorkBuddyCloud.createWorkBuddyCloud(CONFIG);
      return client;
    });
  }

  /* 把云端/网络错误翻成人话 */
  function describe(err, fallback) {
    var message = (err && err.message) ? String(err.message) : "";
    var code = (err && err.code) ? String(err.code) : "";
    if (code === "28000" || message.indexOf("BAD_PASSKEY") >= 0) {
      return { code: "BAD_PASSKEY", message: "钥匙不正确，请再试一次。" };
    }
    if (message.indexOf("INVALID_NAME") >= 0) {
      return { code: code, message: "请填写宾客姓名（30 字以内）。" };
    }
    if (message.indexOf("INVALID_DATES") >= 0) {
      return { code: code, message: "请填写完整的住宿时间。" };
    }
    if (message.indexOf("SDK_") >= 0) {
      return { code: "SDK", message: "云端组件加载失败，请检查网络后刷新页面重试。" };
    }
    if (code === "42501" || code === "42P01") {
      return { code: code, message: "登记通道尚未就绪，请稍后再试。" };
    }
    if (code === "23505") {
      return { code: code, message: "这条记录已经存在了。" };
    }
    if (code === "401" || code === "MISSING_CREDENTIALS" || code === "ACCESS_TOKEN_KID_INVALID") {
      return { code: code, message: "云端暂时不可用，请稍后再试。" };
    }
    return { code: code, message: fallback };
  }

  function marked(o) {
    o.__described = true;
    return o;
  }

  /* 统一收口：调用 → 失败翻译（已翻译过的不再覆盖） */
  function call(fn, fallback) {
    return getClient().then(fn).catch(function (err) {
      if (err && err.__described) throw err;
      throw marked(describe(err, fallback));
    });
  }

  window.WBRSVP = {
    config: CONFIG,

    /* 云服务会校验请求 Origin，只有部署在同一域名下才可用 */
    sameOrigin: function () {
      try {
        return window.location.origin === new URL(CONFIG.endpoint).origin;
      } catch (e) {
        return false;
      }
    },

    /* 提交 / 更新赴约信息，返回 { id, editToken } */
    submit: function (payload) {
      return call(function (c) {
        return c.database.rpc("rsvp_upsert", { payload: payload }).then(function (res) {
          if (res && res.error) throw marked(describe(res.error, "暂时无法保存，请稍后再试。"));
          var data = res ? res.data : null;
          if (Array.isArray(data)) data = data.length ? data[0] : null;
          if (!data || !data.id) throw marked(describe(null, "暂时无法保存，请稍后再试。"));
          return data;
        });
      }, "暂时无法保存，请稍后再试。");
    },

    /* 凭灵钥读取宾客名单 */
    adminList: function (passkey) {
      return call(function (c) {
        return c.database.rpc("admin_rsvps", { passkey: String(passkey || "") }).then(function (res) {
          if (res && res.error) throw marked(describe(res.error, "无法读取宾客登记簿。"));
          return Array.isArray(res && res.data) ? res.data : [];
        });
      }, "无法读取宾客登记簿。");
    },

    session: function () {
      try { return window.sessionStorage.getItem(SESSION_KEY) || ""; } catch (e) { return ""; }
    },
    setSession: function (passkey) {
      try { window.sessionStorage.setItem(SESSION_KEY, String(passkey || "")); } catch (e) {}
    },
    clearSession: function () {
      try { window.sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
    }
  };
})();
