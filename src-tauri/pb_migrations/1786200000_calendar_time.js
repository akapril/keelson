// 日历事件加「时刻」：给 calendar_events 增两个可空 text 字段 start_time / end_time（存 "HH:mm"）。
// all_day 为真时忽略时刻；仅在非全天事件上使用。幂等：加前先 getByName 判空。
migrate((app) => {
  const c = app.findCollectionByNameOrId("calendar_events");
  // 开始时刻（"HH:mm"，5 字符上限）
  if (!c.fields.getByName("start_time")) {
    c.fields.add(new Field({ name: "start_time", type: "text", required: false, max: 5 }));
  }
  // 结束时刻（"HH:mm"，5 字符上限）
  if (!c.fields.getByName("end_time")) {
    c.fields.add(new Field({ name: "end_time", type: "text", required: false, max: 5 }));
  }
  app.save(c);
}, (app) => {
  try {
    const c = app.findCollectionByNameOrId("calendar_events");
    const fs = c.fields.getByName("start_time");
    if (fs) c.fields.removeById(fs.id);
    const fe = c.fields.getByName("end_time");
    if (fe) c.fields.removeById(fe.id);
    app.save(c);
  } catch (_) {}
});
