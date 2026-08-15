# apps/web — gokkehub.com

The hub: game catalogue + the **centralised join** flow. Owning agent: **hub-dev**.

- `functions/api/find-room.ts` is the single room-code lookup: given a code it
  finds which game/app owns that room so `gokkehub.com/join?room=CODE` can redirect.
  When a new game gains joinable rooms, it must be registered here.
- This app has Pages Functions, so CI deploys it with `workingDirectory: apps/web`
  (a bare `pages deploy apps/web/dist` from root skips Functions — see deploy.yml).
- Keep it light; it's mostly a router + catalogue.

Defer: schema → supabase-migrations; visual/catalogue cards → design; deploy → infra-deploy.
