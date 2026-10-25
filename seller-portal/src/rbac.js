// RBAC definitions for the Seller Service Portal.
// This file holds only STATIC data: the catalog of available permissions and the
// default role templates seeded for each new seller. Actual roles live per-seller
// in the sp_roles table and are managed via the Roles UI (see roles.js).

// The full catalog of permissions, grouped for the role editor UI.
const PERMISSION_CATALOG = [
  { key: 'team.manage',          label: 'Manage team & roles',          group: 'Administration' },
  { key: 'settings.manage',      label: 'Manage settings & marketplaces', group: 'Administration' },
  { key: 'support.read',         label: 'View support tickets',         group: 'Sales & Support' },
  { key: 'support.write',        label: 'Create / edit support tickets', group: 'Sales & Support' },
  { key: 'installations.read',   label: 'View installations',           group: 'Sales & Support' },
  { key: 'installations.write',  label: 'Manage installations',         group: 'Sales & Support' },
  { key: 'reviews.read',         label: 'View ratings & reviews',       group: 'Sales & Support' },
  { key: 'reviews.write',        label: 'Manage ratings & reviews',     group: 'Sales & Support' },
  { key: 'listings.read',        label: 'View listings',                group: 'Listings' },
  { key: 'listings.write',       label: 'Manage listings',              group: 'Listings' },
  { key: 'safety.read',          label: 'View safety claims',           group: 'Safety Claims' },
  { key: 'safety.write',         label: 'Manage safety claims',         group: 'Safety Claims' },
];

const PERMISSION_KEYS = PERMISSION_CATALOG.map(p => p.key);
const ALL = [...PERMISSION_KEYS];

// Default roles seeded for every seller. `owner` is special: always full access,
// never editable or deletable (enforced in roles.js). The rest are editable
// starting points; sellers can change their permissions or add custom roles.
const DEFAULT_ROLES = [
  { key: 'owner',         name: 'Owner',         is_system: true, permissions: ALL },
  { key: 'admin',         name: 'Admin',         is_system: true, permissions: ALL },
  { key: 'manager',       name: 'Manager',       is_system: true, permissions:
      ['settings.manage', 'support.read', 'support.write', 'installations.read', 'installations.write',
       'reviews.read', 'reviews.write', 'listings.read', 'listings.write', 'safety.read', 'safety.write'] },
  { key: 'support_agent', name: 'Support Agent', is_system: true, permissions:
      ['support.read', 'support.write', 'installations.read', 'installations.write',
       'reviews.read', 'reviews.write', 'listings.read', 'safety.read'] },
  { key: 'viewer',        name: 'Viewer',        is_system: true, permissions:
      ['support.read', 'installations.read', 'reviews.read', 'listings.read', 'safety.read'] },
];

// Turn a role name into a stable key/slug (custom roles).
function slugify(name) {
  return String(name || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
}

// Keep only valid, de-duplicated permission keys.
function sanitizePermissions(perms) {
  const set = new Set(PERMISSION_KEYS);
  return [...new Set((Array.isArray(perms) ? perms : []).filter(p => set.has(p)))];
}

module.exports = {
  PERMISSION_CATALOG, PERMISSION_KEYS, DEFAULT_ROLES,
  slugify, sanitizePermissions,
};
