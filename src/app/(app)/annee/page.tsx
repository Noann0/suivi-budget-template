import { YearScreen } from "@/components/YearScreen";

export default async function CurrentYearPage() {
  return <YearScreen year={new Date().getFullYear()} />;
}
