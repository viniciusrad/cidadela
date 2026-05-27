"use server";

import { AuthError } from "next-auth";

import { signIn } from "@/auth";

export type LoginActionState = {
  error: string | null;
};

export async function loginAction(
  _previousState: LoginActionState,
  formData: FormData,
): Promise<LoginActionState> {
  try {
    await signIn("credentials", {
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
      redirectTo: "/chat",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return {
        error: "Credenciais invalidas. Revise email e senha.",
      };
    }

    throw error;
  }

  return { error: null };
}
