-- Prisma Migrate's own bookkeeping table (migration names/checksums/timestamps
-- only, no application data) is created outside schema.prisma, so it was
-- missed by 20260908194000_enable_row_level_security's blanket sweep of
-- Prisma-managed tables. Supabase's Security Advisor flags any public-schema
-- table without RLS regardless of whether it holds app data, so enable it
-- here too to clear that finding (no functional effect — Prisma connects as
-- the table-owner role and bypasses RLS, same as every other table).
ALTER TABLE "_prisma_migrations" ENABLE ROW LEVEL SECURITY;
