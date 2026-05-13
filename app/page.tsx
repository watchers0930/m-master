import { CmsShowcasePage } from "@/features/cms/cms-showcase-page";
import { getCmsPublicSections } from "@/server/services/cms-service";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const sections = await getCmsPublicSections();

  return <CmsShowcasePage sections={sections} />;
}
