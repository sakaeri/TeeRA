"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyAdminOrEditor } from "@/lib/auth/session";
import { createManualTodo, resolveTodo, reopenTodo, addTodoComment } from "@/lib/domain/dashboard";

export async function createManualTodoAction(input: {
  title: string;
  dueDate: string;
  recipientUserId: string;
  imageUrl?: string;
}) {
  const { userId, membership } = await requireCompanyAdminOrEditor();

  await createManualTodo({
    companyId: membership.companyId,
    title: input.title,
    dueDate: new Date(`${input.dueDate}T00:00:00.000Z`),
    recipientUserId: input.recipientUserId,
    createdByUserId: userId,
    imageUrl: input.imageUrl,
  });
  revalidatePath("/company");
}

export async function resolveTodoAction(id: string) {
  await requireCompanyAdminOrEditor();
  await resolveTodo(id);
  revalidatePath("/company");
}

export async function reopenTodoAction(id: string) {
  await requireCompanyAdminOrEditor();
  await reopenTodo(id);
  revalidatePath("/company");
}

export async function addTodoCommentAction(todoItemId: string, body: string) {
  const { userId } = await requireCompanyAdminOrEditor();
  await addTodoComment({ todoItemId, authorUserId: userId, body });
  revalidatePath("/company");
}
