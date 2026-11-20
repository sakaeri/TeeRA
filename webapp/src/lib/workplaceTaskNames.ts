// 業務報告の業務内容の候補を勤務先ごとに引くためのキー（依頼主はcompanyRelationshipId、社内は会社ごと）
export function workplaceTaskKey(companyId: string, companyRelationshipId: string | null): string {
  return companyRelationshipId ?? `inhouse:${companyId}`;
}

// 選んでいる勤務先に紐付いている業務内容（1つも無ければ空 → 呼び出し側で「新しい業務内容」の入力を開く）
export function taskNamesForWorkplace(
  taskNamesByWorkplace: Record<string, string[]>,
  companyId: string,
  companyRelationshipId: string | null,
): string[] {
  return taskNamesByWorkplace[workplaceTaskKey(companyId, companyRelationshipId)] ?? [];
}
