import { notFound } from "next/navigation";

import { MonthScreen } from "@/components/MonthScreen";
import { isValidYearMonth } from "@/lib/dates";

type Props = {
  params: Promise<{ year: string; month: string }>;
};

export default async function MonthPage({ params }: Props) {
  const { year: rawYear, month: rawMonth } = await params;
  const year = Number(rawYear);
  const month = Number(rawMonth);

  if (!isValidYearMonth(year, month)) notFound();

  return <MonthScreen year={year} month={month} />;
}
