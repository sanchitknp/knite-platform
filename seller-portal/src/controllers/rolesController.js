// Roles & permissions management. Routes gated by requirePerm('team.manage').
const roles = require('../roles');
const { PERMISSION_CATALOG } = require('../rbac');

// GET /api/roles → all roles for the seller + the permission catalog for the editor
async function list(req, res) {
  const rows = await roles.listRoles(req.auth.seller_id);
  res.json({ roles: rows, catalog: PERMISSION_CATALOG });
}

// POST /api/roles { name, permissions:[] }
async function create(req, res) {
  const r = await roles.createRole(req.auth.seller_id, req.body?.name, req.body?.permissions);
  res.json(r);
}

// PATCH /api/roles/:key { name?, permissions? }
async function update(req, res) {
  const r = await roles.updateRole(req.auth.seller_id, req.params.key, {
    name: req.body?.name,
    permissions: req.body?.permissions,
  });
  res.json(r);
}

// DELETE /api/roles/:key
async function remove(req, res) {
  await roles.deleteRole(req.auth.seller_id, req.params.key);
  res.json({ ok: true });
}

module.exports = { list, create, update, remove };
