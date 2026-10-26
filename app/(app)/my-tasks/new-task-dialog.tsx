"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import type { z } from "zod";
import { sentenceEnum } from "@/lib/format";
import { ownTaskSchema, TASK_PRIORITIES, type OwnTaskInput } from "@/lib/validation";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PillButton } from "@/components/pill-button";
import { FormField, fieldA11y } from "@/components/form-field";
import { SelectField } from "@/components/select-field";
import { SearchSelect, type SearchOption } from "@/components/search-select";
import { DatePicker } from "@/components/date-picker";
import { createOwnTask, searchProjectsForTask } from "../tasks/actions";

type Output = z.output<typeof ownTaskSchema>;

/** My Tasks → New task: find any open project, add a task you own. */
export function NewTaskButton({ isSales }: { isSales: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <PillButton onClick={() => setOpen(true)}>New task</PillButton>
      {open && <NewTaskDialog isSales={isSales} onClose={() => setOpen(false)} />}
    </>
  );
}

function NewTaskDialog({ isSales, onClose }: { isSales: boolean; onClose: () => void }) {
  const router = useRouter();
  const [projects, setProjects] = useState<SearchOption[] | null>(null);
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<OwnTaskInput, unknown, Output>({
    resolver: zodResolver(ownTaskSchema),
    defaultValues: {
      projectId: "",
      title: "",
      priority: "normal",
      dueDate: "",
    },
  });

  useEffect(() => {
    void searchProjectsForTask("").then((res) => {
      if (!res.ok) return void toast.error(res.error);
      setProjects(
        res.data.map((p) => ({
          value: p.id,
          label: `${p.code} · ${p.name}`,
          hint: p.member ? "Your project" : (p.client ?? "Internal"),
          search: p.client ?? "",
        })),
      );
    });
  }, []);

  const onSubmit = handleSubmit(async (values) => {
    const res = await createOwnTask(values);
    if (!res.ok) return void toast.error(res.error);
    toast.success("Task added");
    onClose();
    router.refresh();
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form onSubmit={onSubmit} noValidate className="grid gap-5">
          <DialogHeader>
            <DialogTitle>New task</DialogTitle>
            <DialogDescription>
              {isSales
                ? "Add a task for yourself to any open project. It goes in the project's Sales section."
                : "Add a task for yourself to any open project. You join the project if you aren't on it yet."}
            </DialogDescription>
          </DialogHeader>
          <FormField label="Project" htmlFor="nt-project" required error={errors.projectId?.message}>
            <Controller
              control={control}
              name="projectId"
              render={({ field }) => (
                <SearchSelect
                  id="nt-project"
                  value={field.value}
                  onChange={field.onChange}
                  placeholder={projects ? "Search project, code or client…" : "Loading projects…"}
                  emptyText="No open project matches."
                  options={projects ?? []}
                  disabled={!projects}
                />
              )}
            />
          </FormField>
          <FormField label="Task" htmlFor="nt-title" required error={errors.title?.message}>
            <Input
              {...register("title")}
              {...fieldA11y("nt-title", errors.title?.message)}
              placeholder={isSales ? "e.g. Send the renewal proposal" : "e.g. Prepare the handoff notes"}
            />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Priority" htmlFor="nt-priority">
              <Controller
                control={control}
                name="priority"
                render={({ field }) => (
                  <SelectField
                    id="nt-priority"
                    value={field.value}
                    onChange={field.onChange}
                    options={TASK_PRIORITIES.map((p) => ({
                      value: p,
                      label: sentenceEnum(p),
                    }))}
                  />
                )}
              />
            </FormField>
            <FormField label="Due date" htmlFor="nt-due">
              <Controller
                control={control}
                name="dueDate"
                render={({ field }) => <DatePicker id="nt-due" value={field.value ?? ""} onChange={field.onChange} clearable className="w-full" />}
              />
            </FormField>
          </div>
          <DialogFooter>
            <Button type="button" variant="tertiary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Adding…" : "Add task"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
