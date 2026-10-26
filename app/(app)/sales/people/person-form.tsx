"use client";

import { useRouter } from "next/navigation";
import { Controller, useForm, type Control, type UseFormRegister } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import type { CrmFormOptions, PersonRow } from "@/lib/crm/queries";
import type { Country } from "@/lib/geo/countries";
import { crmPersonSchema, type CrmPersonInput } from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField, fieldA11y } from "@/components/form-field";
import { SearchSelect } from "@/components/search-select";
import { ChipsField, listError } from "@/components/chips-field";
import { RecordForm } from "@/components/record-panel";
import { CountrySelect } from "@/components/country-select";
import { SocialFields, type SocialFieldValues } from "@/components/crm/social-fields";
import { createPerson, updatePerson } from "../crm-actions";

/**
 * Create or edit a person inside the person panel. Name and an email are
 * required; the deals it lists get them as their contact on save, and a
 * company name typed in becomes a new company. `onSaved`
 * gets their id (a new person's panel opens on it).
 */
export function PersonForm({
  person,
  options,
  defaultCompanyId,
  onSaved,
  onCancel,
}: {
  person?: PersonRow;
  options: CrmFormOptions;
  /** A new person from a company's People list starts at that company. */
  defaultCompanyId?: string;
  onSaved: (id: string) => void;
  onCancel: () => void;
}) {
  const router = useRouter();
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CrmPersonInput>({
    // Raw values go to the action, which parses (and transforms) them itself.
    resolver: zodResolver(crmPersonSchema, undefined, { raw: true }),
    defaultValues: {
      name: person?.name ?? "",
      emails: person?.emails ?? [],
      description: person?.description ?? "",
      company: person?.company?.id ?? defaultCompanyId ?? "",
      jobTitle: person?.jobTitle ?? "",
      phones: person?.phones ?? [],
      country: (person?.country as Country | null) ?? null,
      angellist: person?.angellist ?? "",
      facebook: person?.facebook ?? "",
      instagram: person?.instagram ?? "",
      linkedin: person?.linkedin ?? "",
      twitter: person?.twitter ?? "",
      twitterFollowers: person?.twitterFollowers ?? null,
      dealIds: person ? options.deals.filter((d) => d.personId === person.id).map((d) => d.id) : [],
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    if (person) {
      const res = await updatePerson(person.id, values);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Person saved");
      onSaved(person.id);
    } else {
      const res = await createPerson(values);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Person added");
      onSaved(res.data.id);
    }
    router.refresh();
  });

  return (
    <RecordForm
      icon="user"
      title={person ? `Edit ${person.name}` : "New person"}
      meta={<span className="truncate">{person ? (person.email ?? "No email") : "A contact — at a company, or on their own."}</span>}
      onSubmit={onSubmit}
      footer={
        <>
          <span />
          <div className="flex gap-2">
            <Button type="button" variant="tertiary" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : person ? "Save" : "Add person"}
            </Button>
          </div>
        </>
      }
    >
      <div className="grid gap-4">
        <FormField label="Name" htmlFor="pe-name" required error={errors.name?.message}>
          <Input {...register("name")} {...fieldA11y("pe-name", errors.name?.message)} placeholder="e.g. Sari Wijaya" />
        </FormField>
        <FormField label="Email addresses" htmlFor="pe-emails" required error={listError(errors.emails)} hint="The first is the primary one. Email with these addresses is matched to them.">
          <Controller
            control={control}
            name="emails"
            render={({ field }) => (
              <ChipsField
                id="pe-emails"
                value={field.value ?? []}
                onChange={field.onChange}
                creatable
                normalize={(v) => v.trim().toLowerCase()}
                placeholder="sari@kopisenja.id"
                error={listError(errors.emails)}
              />
            )}
          />
        </FormField>
        <FormField label="Description" htmlFor="pe-description" error={errors.description?.message}>
          <Textarea {...register("description")} id="pe-description" rows={3} placeholder="How we know them, what they care about" />
        </FormField>
        <div className="grid gap-4 @sm:grid-cols-2">
          <FormField label="Company" htmlFor="pe-company">
            <Controller
              control={control}
              name="company"
              render={({ field }) => (
                <SearchSelect
                  id="pe-company"
                  value={field.value}
                  onChange={field.onChange}
                  noneLabel="No company"
                  placeholder="Search or create…"
                  emptyText="No company found."
                  createLabel={(name) => `Create company “${name}”`}
                  options={options.companies.map((c) => ({ value: c.id, label: c.name, hint: c.domain ?? undefined }))}
                />
              )}
            />
          </FormField>
          <FormField label="Job title" htmlFor="pe-job" error={errors.jobTitle?.message}>
            <Input {...register("jobTitle")} {...fieldA11y("pe-job", errors.jobTitle?.message)} placeholder="e.g. Marketing lead" />
          </FormField>
        </div>
        <FormField label="Phone numbers" htmlFor="pe-phones" error={listError(errors.phones)}>
          <Controller
            control={control}
            name="phones"
            render={({ field }) => (
              <ChipsField id="pe-phones" value={field.value ?? []} onChange={field.onChange} creatable placeholder="+62 812 3456 7890" error={listError(errors.phones)} />
            )}
          />
        </FormField>
        <FormField label="Country" htmlFor="pe-country" error={errors.country?.message}>
          <Controller
            control={control}
            name="country"
            render={({ field }) => <CountrySelect id="pe-country" value={field.value} onChange={(v) => field.onChange(v || null)} noneLabel="Not set" />}
          />
        </FormField>

        <SocialFields
          idPrefix="pe"
          register={register as unknown as UseFormRegister<SocialFieldValues>}
          control={control as unknown as Control<SocialFieldValues>}
          errors={errors}
        />

        <FormField label="Associated deals" htmlFor="pe-deals" hint="Deals with this person as their contact.">
          <Controller
            control={control}
            name="dealIds"
            render={({ field }) => (
              <ChipsField
                id="pe-deals"
                value={field.value ?? []}
                onChange={field.onChange}
                options={options.deals.map((d) => ({ value: d.id, label: d.title }))}
                placeholder="Add deals"
                emptyText="No deal found."
              />
            )}
          />
        </FormField>
      </div>
    </RecordForm>
  );
}
