"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyAdminOrEditor } from "@/lib/auth/session";
import { createManualTodo, resolveTodo, reopenTodo, addTodoComment } from "@/lib/domain/dashboard";
import { prisma } from "@/lib/prisma";

async function assertTodoOwnedByCompany(todoItemId: string, companyId: string) {
  const todo = await prisma.todoItem.findFirstOrThrow({ where: { id: todoItemId, companyId } });
  return todo;
}

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
  const { membership } = await requireCompanyAdminOrEditor();
  await assertTodoOwnedByCompany(id, membership.companyId);
  await resolveTodo(id);
  revalidatePath("/company");
}

export async function reopenTodoAction(id: string) {
  const { membership } = await requireCompanyAdminOrEditor();
  await assertTodoOwnedByCompany(id, membership.companyId);
  await reopenTodo(id);
  revalidatePath("/company");
}

export async function addTodoCommentAction(todoItemId: string, body: string) {
  const { userId, membership } = await requireCompanyAdminOrEditor();
  await assertTodoOwnedByCompany(todoItemId, membership.companyId);
  await addTodoComment({ todoItemId, authorUserId: userId, body });
  revalidatePath("/company");
}
