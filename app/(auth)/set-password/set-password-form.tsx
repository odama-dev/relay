"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { passwordSchema, type PasswordInput } from "@/lib/validation";
import { updatePassword } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField, fieldA11y } from "@/components/form-field";
import { cn } from "@/lib/utils";

export function SetPasswordForm({ className }: { className?: string }) {
  const router = useRouter();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<PasswordInput>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { password: "", confirm: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    const res = await updatePassword(values);
    if (!res.ok) {
      setError("password", { message: res.error });
      return;
    }
    toast.success("Password saved");
    router.replace("/");
  });

  return (
    <form onSubmit={onSubmit} className={cn("flex flex-col gap-3", className)} noValidate>
      <FormField label="New password" htmlFor="password" error={errors.password?.message} hint="At least 8 characters.">
        <Input
          type="password"
          autoComplete="new-password"
          autoFocus
          {...fieldA11y("password", errors.password?.message, true)}
          {...register("password")}
        />
      </FormField>
      <FormField label="Confirm password" htmlFor="confirm" error={errors.confirm?.message}>
        <Input
          type="password"
          autoComplete="new-password"
          {...fieldA11y("confirm", errors.confirm?.message)}
          {...register("confirm")}
        />
      </FormField>
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Saving…" : "Save password & continue"}
      </Button>
    </form>
  );
}
