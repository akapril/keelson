// rework 初始迁移：扩展 users + 会话元数据三表。每表带 owner + access rules。
migrate((app) => {
  // 为 users 集合添加 displayName 字段
  const users = app.findCollectionByNameOrId("users");
  users.fields.add(new Field({ name: "displayName", type: "text", required: false }));
  app.save(users);

  // 每张表共用的访问规则：仅限认证用户访问自己的记录
  // 注意：updateRule 不使用 @request.body.owner:changed（PB v0.30 中会导致 PATCH 404），
  //       改为等效的 auth + owner 双重检查。
  const rules = {
    listRule: '@request.auth.id != "" && owner = @request.auth.id',
    viewRule: '@request.auth.id != "" && owner = @request.auth.id',
    createRule: '@request.auth.id != "" && @request.body.owner = @request.auth.id',
    updateRule: '@request.auth.id != "" && owner = @request.auth.id',
    deleteRule: '@request.auth.id != "" && owner = @request.auth.id',
  };

  // 关联到 users 的 owner 字段工厂（级联删除）
  const ownerField = () => new Field({
    name: "owner", type: "relation", required: true,
    collectionId: app.findCollectionByNameOrId("users").id,
    cascadeDelete: true, maxSelect: 1,
  });

  // sessions_meta：会话元数据主表
  const meta = new Collection({ name: "sessions_meta", type: "base", ...rules });
  meta.fields.add(ownerField());
  meta.fields.add(new Field({ name: "session_id", type: "text", required: true }));
  meta.fields.add(new Field({ name: "provider", type: "text" }));
  meta.fields.add(new Field({ name: "project_path", type: "text" }));
  meta.fields.add(new Field({ name: "project_name", type: "text" }));
  meta.fields.add(new Field({ name: "custom_name", type: "text" }));
  meta.fields.add(new Field({ name: "favorite", type: "bool" }));
  meta.fields.add(new Field({ name: "hidden", type: "bool" }));
  meta.fields.add(new Field({ name: "last_prompt", type: "text" }));
  meta.fields.add(new Field({ name: "message_count", type: "number" }));
  meta.fields.add(new Field({ name: "total_tokens", type: "number" }));
  meta.fields.add(new Field({ name: "content_hash", type: "text" }));
  meta.fields.add(new Field({ name: "orphaned", type: "bool" }));
  meta.addIndex("idx_meta_owner_sid", true, "owner, session_id", "");
  app.save(meta);

  // session_tags：会话标签（多对多，通过 session_id 关联）
  const tags = new Collection({ name: "session_tags", type: "base", ...rules });
  tags.fields.add(ownerField());
  tags.fields.add(new Field({ name: "session_id", type: "text", required: true }));
  tags.fields.add(new Field({ name: "tag", type: "text", required: true }));
  tags.addIndex("idx_tags_unique", true, "owner, session_id, tag", "");
  app.save(tags);

  // session_notes：会话备注（每会话一条）
  const notes = new Collection({ name: "session_notes", type: "base", ...rules });
  notes.fields.add(ownerField());
  notes.fields.add(new Field({ name: "session_id", type: "text", required: true }));
  notes.fields.add(new Field({ name: "content", type: "text" }));
  notes.addIndex("idx_notes_unique", true, "owner, session_id", "");
  app.save(notes);
}, (app) => {
  // 回滚：删除三张自定义表（users 字段无需回滚）
  for (const n of ["sessions_meta", "session_tags", "session_notes"]) {
    try { app.delete(app.findCollectionByNameOrId(n)); } catch (_) {}
  }
});
