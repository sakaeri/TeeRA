import { requireCompanyAdminOrEditor } from "@/lib/auth/session";
import { listStaffWithSummary } from "@/lib/domain/roster";
import { listClients, listAgencies } from "@/lib/domain/relationships";
import { listTeams } from "@/lib/domain/teams";
import { listTemplates, listKnownTaskNames } from "@/lib/domain/contracts";
import { RosterView } from "@/components/company/RosterView";

const EMPLOYMENT_TYPE_LABEL: Record<string, string> = {
  PART_TIME: "アルバイト",
  FIXED_TERM_EMPLOYEE: "契約社員",
  FULL_TIME: "正社員",
  CONTRACTOR: "業務委託",
  DISPATCH_STAFF: "派遣社員",
};
const WAGE_TYPE_LABEL: Record<string, string> = { HOURLY: "時給", DAILY: "日給", MONTHLY: "月給" };

export default async function RosterPage() {
  const { membership } = await requireCompanyAdminOrEditor();

  // 依頼主一覧/派遣会社一覧タブは常時表示する（スタッフ一覧と同じく、0件でも
  // 「追加する」ボタン付きの空状態を出す）ので、agencyEnabled/dispatchEnabled
  // に関わらず常に取得する。
  const [staff, clients, agencies, teams, templates, knownTaskNames] = await Promise.all([
    listStaffWithSummary(membership.companyId),
    listClients(membership.companyId),
    listAgencies(membership.companyId),
    listTeams(membership.companyId),
    listTemplates(membership.companyId),
    listKnownTaskNames(membership.companyId),
  ]);

  return (
    <main className="mx-auto w-full max-w-5xl px-8 py-10">
      <RosterView
        staff={staff}
        knownTaskNames={knownTaskNames}
        clients={clients.map((c) => ({
          id: c.id,
          name: c.clientCompany?.name ?? c.proxyName ?? "(名称未設定)",
          isProxy: !c.clientCompany,
          status: c.status,
        }))}
        agencies={agencies.map((a) => ({
          id: a.id,
          name: a.agencyCompany?.name ?? a.proxyName ?? "(名称未設定)",
          isProxy: !a.agencyCompany,
          status: a.status,
        }))}
        teams={teams.map((t) => ({ id: t.id, name: t.name }))}
        templates={templates
          .filter((t) => t.status !== "ARCHIVED")
          .map((t) => ({
            id: t.id,
            title: t.title,
            employmentTypeLabel: EMPLOYMENT_TYPE_LABEL[t.employmentType] ?? t.employmentType,
            wageLabel: `${WAGE_TYPE_LABEL[t.wageType]}${t.wageAmount}円`,
            workplaceName:
              t.workplaceType === "CLIENT"
                ? (t.workplaceNote ?? t.companyRelationship?.clientCompany?.name ?? t.companyRelationship?.proxyName ?? "配属先")
                : "自社",
            contractStartDate: t.contractStartDate.toISOString().slice(0, 10),
          }))}
      />
    </main>
  );
}
