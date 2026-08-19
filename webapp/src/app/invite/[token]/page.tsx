import Link from "next/link";
import { auth } from "@/auth";
import { lookupInvite } from "@/lib/domain/invites";
import { redeemInviteAction } from "@/app/actions/auth";
import { prisma } from "@/lib/prisma";

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

  const existingMembership = await prisma.companyMembership.findFirst({
    where: { userId: session.user.id },
  });

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

        {errorKey === "user_already_has_company" ? (
          <p className="mb-4 text-sm text-red-600">
            このアカウントはすでに別の本部に所属しているため、この招待を受け取れません。
          </p>
        ) : null}

        {existingMembership ? (
          <p className="text-sm text-red-600">
            このアカウントはすでに別の本部に所属しているため、この招待を受け取れません。
          </p>
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
