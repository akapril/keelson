/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_3371181252")

  // update collection data
  unmarshal({
    "updateRule": "@request.auth.id != \"\" && owner = @request.auth.id"
  }, collection)

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_3371181252")

  // update collection data
  unmarshal({
    "updateRule": "owner = @request.auth.id && @request.body.owner:changed = false"
  }, collection)

  return app.save(collection)
})
