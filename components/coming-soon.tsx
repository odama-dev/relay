import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states";
import { MetalBadge } from "@/components/metal-badge";

/** A module that isn't open yet: its route renders this instead of the page (see the route's layout.tsx). */
export function ComingSoon({ title }: { title: string }) {
  return (
    <div className="flex flex-1 flex-col">
      <PageHeader title={title} compact actions={<MetalBadge>Coming soon</MetalBadge>} />
      <EmptyState icon="intelligence" title={`${title} is coming soon`} description="This part of Performance isn't open yet. We'll let you know when it is." />
    </div>
  );
}
