import { notFound } from "next/navigation";

import { YearScreen } from "@/components/YearScreen";
import { MAX_YEAR, MIN_YEAR } from "@/lib/dates";

type Props = {
  params: Promise<{ year: string }>;
};

export default async function YearPage({ params }: Props) {
  const { year: rawYear } = await params;
  const year = Number(rawYear);

  if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) notFound();

  return <YearScreen year={year} />;
}
