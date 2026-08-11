// keelson 改名兼容：把本地唯一用户的邮箱 you@local.rework → you@local.keelson。
// **不改记录 id** → 每条记录的 owner 归属不变、数据不丢，只是登录邮箱字段更名，
// 与 bootstrap 里 LOCAL_EMAIL 的改名保持一致（否则 bootstrap 按新邮箱找不到用户会新建 → 旧数据孤儿）。
// 幂等 + try/catch：找不到旧邮箱用户（全新安装 / 已迁移）就跳过，绝不让 automigrate 失败。
migrate(
  (app) => {
    let rec = null;
    try {
      rec = app.findFirstRecordByFilter("users", "email = 'you@local.rework'");
    } catch (e) {
      rec = null;
    }
    if (rec) {
      rec.set("email", "you@local.keelson");
      app.save(rec);
    }
  },
  (app) => {
    // 回滚：改回旧邮箱
    let rec = null;
    try {
      rec = app.findFirstRecordByFilter("users", "email = 'you@local.keelson'");
    } catch (e) {
      rec = null;
    }
    if (rec) {
      rec.set("email", "you@local.rework");
      app.save(rec);
    }
  },
);
