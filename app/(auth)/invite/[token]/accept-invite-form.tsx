"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { passwordSchema, type PasswordInput } from "@/lib/validation";
import { acceptInvite } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { PasswordField } from "@/components/password-field";
import { FormField, fieldA11y } from "@/components/form-field";
import { cn } from "@/lib/utils";

export function AcceptInviteForm({ token, className }: { token: string; className?: string }) {
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<PasswordInput>({ resolver: zodResolver(passwordSchema), defaultValues: { password: "", confirm: "" } });

  const onSubmit = handleSubmit(async (values) => {
    // Redirects into the app on success.
    const res = await acceptInvite(token, values);
    if (res && !res.ok) setError("password", { message: res.error });
  });

  return (
    <form onSubmit={onSubmit} className={cn("flex flex-col gap-3", className)} noValidate>
      <FormField label="Password" htmlFor="password" error={errors.password?.message} hint="At least 8 characters.">
        <PasswordField autoComplete="new-password" autoFocus {...fieldA11y("password", errors.password?.message, true)} {...register("password")} />
      </FormField>
      <FormField label="Confirm password" htmlFor="confirm" error={errors.confirm?.message}>
        <PasswordField autoComplete="new-password" {...fieldA11y("confirm", errors.confirm?.message)} {...register("confirm")} />
      </FormField>
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Setting up…" : "Create password & sign in"}
      </Button>
    </form>
  );
}
