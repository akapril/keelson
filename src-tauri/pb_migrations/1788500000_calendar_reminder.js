// 日历事件加「提醒」：给 calendar_events 增两个字段——
//   remind_at（text，UTF 定宽 ISO 如 "2026-09-03T14:30:00Z"，空=不提醒）；
//   reminded（bool，是否已推送提醒，去重用，默认 false）。
// 仅当自然语言含「提醒」意图时前端才写 remind_at；后台 worker 按 remind_at<=now 且 !reminded 推送。
// 幂等：加前先 getByName 判空。
migrate((app) => {
  const c = app.findCollectionByNameOrId("calendar_events");
  // 提醒时间（UTC ISO 定宽字符串，便于字典序=时间序比较；空=不提醒）
  if (!c.fields.getByName("remind_at")) {
    c.fields.add(new Field({ name: "remind_at", type: "text", required: false, max: 40 }));
  }
  // 是否已提醒（去重：worker 推送后置 true）
  if (!c.fields.getByName("reminded")) {
    c.fields.add(new Field({ name: "reminded", type: "bool", required: false }));
  }
  app.save(c);
}, (app) => {
  try {
    const c = app.findCollectionByNameOrId("calendar_events");
    const fr = c.fields.getByName("remind_at");
    if (fr) c.fields.removeById(fr.id);
    const fd = c.fields.getByName("reminded");
    if (fd) c.fields.removeById(fd.id);
    app.save(c);
  } catch (_) {}
});
