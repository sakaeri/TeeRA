"use client";

import { useActionState } from "react";
import { createCompanyAction, type FormState } from "@/app/actions/auth";

export function CreateCompanyForm({ inviteToken }: { inviteToken?: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    createCompanyAction,
    undefined,
  );

  return (
    <form action={action} className="flex flex-col gap-4">
      {inviteToken ? <input type="hidden" name="invite" value={inviteToken} /> : null}
      <div className="flex flex-col gap-1">
        <label htmlFor="name" className="text-sm text-foreground/80">
          本部名
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          placeholder="例）株式会社サンプル"
          className="rounded-lg border border-border bg-white px-3.5 py-2.5 text-sm outline-none focus:border-primary"
        />
        {state?.errors?.name ? (
          <p className="text-xs text-red-600">{state.errors.name[0]}</p>
        ) : null}
      </div>

      <button
        type="submit"
        disabled={pending}
        className="mt-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
      >
        {pending ? "作成中…" : "本部を作成"}
      </button>
    </form>
  );
}
