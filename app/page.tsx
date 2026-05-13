import { CmsShowcasePage } from "@/features/cms/cms-showcase-page";
import { getCmsPublicSections } from "@/server/services/cms-service";
import { unstable_noStore as noStore } from "next/cache";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function HomePage() {
  noStore();
  const sections = await getCmsPublicSections();

  return <CmsShowcasePage sections={sections} />;
}
