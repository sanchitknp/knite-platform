# RBAC — Roles & Permissions

Roles are **per-seller and data-driven** (stored in `sp_roles`), with a UI for the
admin to edit them and create custom ones. The permission **catalog** and the
**default role templates** are static code in [`src/rbac.js`](../src/rbac.js); the
DB access, caching, and the `requirePerm()` middleware are in
[`src/roles.js`](../src/roles.js).

## Permissions (the catalog)

12 permissions, grouped (this is what the role editor shows):

| Group | Permission | Lets you… |
|-------|-----------|-----------|
| Administration | `team.manage` | add/edit employees, manage roles |
| Administration | `settings.manage` | marketplaces, products, regenerate request links |
| Sales & Support | `support.read` / `support.write` | view / create & edit tickets |
| Sales & Support | `installations.read` / `installations.write` | view / manage installations, assign techs, send review requests |
| Sales & Support | `reviews.read` / `reviews.write` | (reserved — legacy reviews module) |
| Listings | `listings.read` / `listings.write` | view / manage listings |
| Safety Claims | `safety.read` / `safety.write` | view / manage safety claims |

## Default roles (seeded per seller)

| Role | Permissions |
|------|-------------|
| **Owner** | everything, **always** (immutable, can't be deleted/disabled; it's the signup account) |
| **Admin** | everything (appointed by the owner) |
| **Manager** | all module read/write + `settings.manage`; **no** `team.manage` |
| **Support Agent** | support/installations/reviews read+write, listings/safety read-only |
| **Viewer** | read-only everywhere |

Sellers can **edit** any role's permissions (except Owner) and **create custom
roles** via the **Roles** page. Built-in roles can't be deleted; custom roles can
be deleted only when no user is assigned to them.

## How it's enforced (server-side, always)

1. **Login** sets a JWT (httpOnly cookie). `requireAuth` loads the **live** user
   row each request and sets `req.auth = { user_id, seller_id, role, email }`.
2. Each protected route is wrapped with **`requirePerm('<perm>')`** (see the route
   table in `src/server.js`), e.g.
   `app.post('/api/tickets', requirePerm('support.write'), ...)`.
3. `requirePerm` resolves the user's role → its permission set from `sp_roles`
   (30s in-process cache, invalidated on any role edit) and 403s if missing.
   `owner` always passes.

The UI also hides buttons/nav the user lacks (`can(perm)` in `app.js` using the
`permissions` array from `/api/auth/me`), but **the server is the source of
truth** — hiding is cosmetic.

## Guards worth knowing

- You can't change your own role or status (no self-lockout).
- Only the Owner can modify the Owner account; the Owner can't be demoted/disabled.
- Only the Owner can grant `admin`.
- Editing a role's permissions takes effect ~immediately (cache invalidation +
  live-user load), without users re-logging in.

## Endpoints

| Method & path | Perm | |
|---|---|---|
| `GET /api/team` | `team.manage` | list users + assignable roles |
| `POST /api/team` | `team.manage` | add employee |
| `PATCH /api/team/:id` | `team.manage` | change name/role/status |
| `POST /api/team/:id/reset-password` | `team.manage` | |
| `GET /api/roles` | `team.manage` | roles + permission catalog |
| `POST /api/roles` | `team.manage` | create custom role |
| `PATCH /api/roles/:key` | `team.manage` | edit name/permissions |
| `DELETE /api/roles/:key` | `team.manage` | delete custom role |
