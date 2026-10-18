-- 自社都合の解除も変更履歴に理由を出せるよう記録する（キャンセル料は0）
ALTER TYPE "CancellationSource" ADD VALUE 'AGENCY_OWN';
