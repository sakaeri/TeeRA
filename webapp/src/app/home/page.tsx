import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { verifySession, listMyMemberships, ACTIVE_COMPANY_COOKIE } from "@/lib/auth/session";
import { setActiveCompanyAction } from "@/app/actions/auth";

const ROLE_LABEL: Record<string, string> = {
  COMPANY_ADMIN: "管理者",
  COMPANY_EDITOR: "編集者",
  STAFF: "スタッフ",
};

export default async function HomeGatePage({ searchParams }: PageProps<"/home">) {
  const { userId } = await verifySession();
  const memberships = await listMyMemberships(userId);

  if (memberships.length === 0) {
    redirect("/register/company");
  }
  if (memberships.length === 1) {
    redirect(memberships[0].role === "STAFF" ? "/staff" : "/company");
  }

  // 複数社所属 — 前回選んだ会社（Cookie）が今も有効ならそのまま入る。
  // ただし各シェルの「会社を切り替える」リンクからは?switch=1で来るので、
  // その場合はCookieを無視して必ず選択画面を出す。
  const sp = await searchParams;
  const forceSwitch = sp.switch === "1";
  const store = await cookies();
  const activeCompanyId = store.get(ACTIVE_COMPANY_COOKIE)?.value;
  const active = !forceSwitch && memberships.find((m) => m.companyId === activeCompanyId);
  if (active) {
    redirect(active.role === "STAFF" ? "/staff" : "/company");
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-16">
      <div className="mb-8 text-center font-serif-jp text-2xl font-bold text-primary">
        TeeRA
      </div>
      <div className="rounded-2xl border border-border bg-white/60 p-6">
        <h1 className="mb-4 text-center text-lg font-semibold">会社を選択してください</h1>
        <div className="flex flex-col gap-2">
          {memberships.map((m) => (
            <form
              key={m.companyId}
              action={async () => {
                "use server";
                await setActiveCompanyAction(m.companyId);
              }}
            >
              <button
                type="submit"
                className="flex w-full items-center justify-between rounded-lg border border-border bg-white px-4 py-3 text-sm hover:border-primary"
              >
                <span>{m.companyName}</span>
                <span className="text-xs text-muted">{ROLE_LABEL[m.role] ?? m.role}</span>
              </button>
            </form>
          ))}
        </div>
      </div>
    </main>
  );
}
