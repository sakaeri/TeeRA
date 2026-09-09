import { confirmEmailChangeAction } from "@/app/actions/account";

export default async function ConfirmEmailChangePage({
  params,
}: PageProps<"/confirm-email-change/[token]">) {
  const { token } = await params;
  await confirmEmailChangeAction(token);
}
