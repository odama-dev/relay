"use client";

import { Controller, type Control, type FieldErrors, type UseFormRegister } from "react-hook-form";
import { SOCIALS, SOCIAL_LABELS } from "@/lib/crm/pure";
import { Input } from "@/components/ui/input";
import { AmountInput } from "@/components/amount-input";
import { FormField, fieldA11y } from "@/components/form-field";

/** The social profile fields both CRM forms share. */
export type SocialFieldValues = {
  angellist?: string;
  facebook?: string;
  instagram?: string;
  linkedin?: string;
  twitter?: string;
  twitterFollowers?: number | null;
};

const PLACEHOLDERS = {
  angellist: "wellfound.com/…",
  facebook: "facebook.com/…",
  instagram: "@handle",
  linkedin: "linkedin.com/…",
  twitter: "@handle",
} as const;

/**
 * AngelList, Facebook, Instagram, LinkedIn and Twitter (a link or a handle),
 * then the follower count. The form passes its own register / control, cast
 * to this shape.
 */
export function SocialFields({
  idPrefix,
  register,
  control,
  errors,
}: {
  idPrefix: string;
  register: UseFormRegister<SocialFieldValues>;
  control: Control<SocialFieldValues>;
  errors: FieldErrors<SocialFieldValues>;
}) {
  return (
    <div className="grid gap-4 @sm:grid-cols-2">
      {SOCIALS.map((key) => (
        <FormField key={key} label={SOCIAL_LABELS[key]} htmlFor={`${idPrefix}-${key}`} error={errors[key]?.message}>
          <Input {...register(key)} {...fieldA11y(`${idPrefix}-${key}`, errors[key]?.message)} placeholder={PLACEHOLDERS[key]} />
        </FormField>
      ))}
      <FormField label="Twitter follower count" htmlFor={`${idPrefix}-followers`} error={errors.twitterFollowers?.message}>
        <Controller
          control={control}
          name="twitterFollowers"
          render={({ field }) => <AmountInput value={field.value} onChange={field.onChange} decimals={0} {...fieldA11y(`${idPrefix}-followers`, errors.twitterFollowers?.message)} />}
        />
      </FormField>
    </div>
  );
}
