// rework 文档图片附件迁移：doc_assets 集合（承载文档内嵌图片）。
// 为何独立集合：PB text 字段不宜存 base64（撑爆正文、拖慢每次加载），图片走 file 字段更合适。
// file 字段 protected=true → 受保护，浏览器 <img> 需追加文件 token（前端 resolveAssetURL 渲染时补发）。
// owner-only 访问；不提供 updateRule（图片一次性上传，不改）。
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");

  // autodate：PB 0.30 base 表不自动加 created，需显式添加。
  const auto = (name) =>
    new Field({ name, type: "autodate", onCreate: true, onUpdate: false });

  const assets = new Collection({
    name: "doc_assets",
    type: "base",
    listRule: `@request.auth.id != "" && owner = @request.auth.id`,
    viewRule: `@request.auth.id != "" && owner = @request.auth.id`,
    createRule: `@request.auth.id != "" && @request.body.owner = @request.auth.id`,
    deleteRule: `owner = @request.auth.id`,
  });
  assets.fields.add(
    new Field({
      name: "owner",
      type: "relation",
      required: true,
      collectionId: users.id,
      cascadeDelete: true,
      maxSelect: 1,
    }),
  );
  assets.fields.add(
    new Field({
      name: "file",
      type: "file",
      required: true,
      maxSelect: 1,
      maxSize: 10485760, // 10MB 上限
      mimeTypes: [
        "image/png",
        "image/jpeg",
        "image/gif",
        "image/webp",
        "image/svg+xml",
      ],
      protected: true, // 受保护：需文件 token 访问，配合前端 resolveAssetURL
    }),
  );
  assets.fields.add(auto("created"));
  assets.addIndex("idx_doc_assets_owner", false, "owner", "");
  app.save(assets);
}, (app) => {
  try {
    app.delete(app.findCollectionByNameOrId("doc_assets"));
  } catch (_) {}
});
