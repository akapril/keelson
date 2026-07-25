// 项目收藏：board_projects 加 pinned(是否收藏) + pin_rank(收藏项排序键，浮点，复用 board rank)。
migrate((app) => {
  const c = app.findCollectionByNameOrId("board_projects");
  c.fields.add(new Field({ name: "pinned", type: "bool" }));
  c.fields.add(new Field({ name: "pin_rank", type: "number" }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("board_projects");
  const pin = c.fields.getByName("pinned");
  const rank = c.fields.getByName("pin_rank");
  if (pin) c.fields.removeById(pin.id);
  if (rank) c.fields.removeById(rank.id);
  app.save(c);
});
