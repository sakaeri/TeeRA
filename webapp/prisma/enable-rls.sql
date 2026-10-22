-- publicスキーマの全テーブルに行レベルセキュリティ（RLS）をかける。
-- アプリはSupabaseのData API（PostgREST）を使わず、テーブルの持ち主のロールで
-- 直接つなぐ（持ち主はRLSの対象外）ので、ポリシーは作らない＝Data API経由の
-- 読み書きはすべて拒否される。Data APIを切っていても二重の守りとして、
-- デプロイのたびに実行して新しく増えたテーブルにもかける（何度実行しても同じ）。
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND NOT c.relrowsecurity
      AND pg_get_userbyid(c.relowner) = current_user
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.relname);
  END LOOP;
END $$;
