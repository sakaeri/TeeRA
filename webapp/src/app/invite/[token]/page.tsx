import Link from "next/link";
import { auth } from "@/auth";
import { lookupInvite } from "@/lib/domain/invites";
import { redeemInviteAction, redeemCompanyRelationshipInviteAction } from "@/app/actions/auth";
import { listMyMemberships, getActiveMembership } from "@/lib/auth/session";

const KIND_LABEL: Record<string, string> = {
  STAFF: "スタッフ",
  COMPANY_ADMIN_TRANSFER: "本部管理者/編集者",
  CLIENT_UPGRADE: "依頼主",
  AGENCY_UPGRADE: "派遣会社",
};

export default async function InvitePage({
  params,
  searchParams,
}: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const sp = await searchParams;
  const errorKey = typeof sp.error === "string" ? sp.error : undefined;

  const session = await auth();
  const result = await lookupInvite(token);

  if (result.status === "not_found") {
    return <InviteMessage title="招待リンクが見つかりません" />;
  }
  if (result.status === "used") {
    return <InviteMessage title="この招待リンクはすでに使用されています" />;
  }
  if (result.status === "expired") {
    return <InviteMessage title="この招待リンクは有効期限が切れています" />;
  }

  const { invite } = result;
  const teamName = invite.team?.name;

  if (!session?.user?.id) {
    return (
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-16">
        <div className="mb-8 text-center font-serif-jp text-2xl font-bold text-primary">
          TeeRA
        </div>
        <div className="rounded-2xl border border-border bg-white/60 p-6 text-center">
          <h1 className="mb-2 text-lg font-semibold">
            {invite.company.name} への招待
          </h1>
          <p className="mb-6 text-sm text-muted">
            {KIND_LABEL[invite.kind] ?? invite.kind}
            {teamName ? `（${teamName}）` : ""}
            として参加します。まずアカウントを作成してください。
          </p>
          <Link
            href={`/register?invite=${token}`}
            className="block rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
          >
            アカウントを作成して参加する
          </Link>
        </div>
      </main>
    );
  }

  // ダブルワーク・兼務対応: 複数社所属を許すので、「どこか1社にでも
  // 所属していたら拒否」ではなく、この招待先の会社に既に所属しているかだけ
  // を見る。CLIENT_UPGRADE/AGENCY_UPGRADE（会社同士を結びつける招待）は
  // 「今どの会社として動いているか」（アクティブ会社）で受諾する。
  const myMemberships = await listMyMemberships(session.user.id);
  const membershipAtThisCompany = myMemberships.find((m) => m.companyId === invite.companyId);
  const isCompanyRelationshipInvite = invite.kind === "CLIENT_UPGRADE" || invite.kind === "AGENCY_UPGRADE";
  const activeMembership = isCompanyRelationshipInvite ? await getActiveMembership(session.user.id) : null;

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-16">
      <div className="mb-8 text-center font-serif-jp text-2xl font-bold text-primary">
        TeeRA
      </div>
      <div className="rounded-2xl border border-border bg-white/60 p-6 text-center">
        <h1 className="mb-2 text-lg font-semibold">
          {invite.company.name} への招待
        </h1>
        <p className="mb-6 text-sm text-muted">
          {KIND_LABEL[invite.kind] ?? invite.kind}
          {teamName ? `（${teamName}）` : ""}
          として参加します。
        </p>

        {errorKey === "already_member_of_this_company" ? (
          <p className="mb-4 text-sm text-red-600">
            このアカウントはすでにこの会社に所属しています。
          </p>
        ) : null}
        {errorKey === "requires_admin" ? (
          <p className="mb-4 text-sm text-red-600">
            自社の管理者/編集者のみがこの招待を受け取れます。
          </p>
        ) : null}

        {isCompanyRelationshipInvite ? (
          !activeMembership ? (
            <div>
              <p className="mb-4 text-sm text-muted">
                この招待は会社同士を結びつけるものです。先に自社の本部を作成してください。
              </p>
              <Link
                href={`/register/company?invite=${token}`}
                className="block rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
              >
                本部を作成する
              </Link>
            </div>
          ) : activeMembership.role === "STAFF" ? (
            <p className="text-sm text-red-600">自社の管理者/編集者のみがこの招待を受け取れます。</p>
          ) : (
            <form
              action={async () => {
                "use server";
                await redeemCompanyRelationshipInviteAction(token);
              }}
            >
              <button
                type="submit"
                className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
              >
                {activeMembership.companyName}として招待を受け取る
              </button>
            </form>
          )
        ) : membershipAtThisCompany ? (
          <p className="text-sm text-red-600">このアカウントはすでにこの会社に所属しています。</p>
        ) : (
          <form
            action={async () => {
              "use server";
              await redeemInviteAction(token);
            }}
          >
            <button
              type="submit"
              className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
            >
              参加する
            </button>
          </form>
        )}
      </div>
    </main>
  );
}

function InviteMessage({ title }: { title: string }) {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-16">
      <div className="mb-8 text-center font-serif-jp text-2xl font-bold text-primary">
        TeeRA
      </div>
      <div className="rounded-2xl border border-border bg-white/60 p-6 text-center">
        <h1 className="text-lg font-semibold">{title}</h1>
      </div>
    </main>
  );
}
