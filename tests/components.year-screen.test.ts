import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const debt = {
  kind: "opening-balance-debt",
  name: "Dette antérieure" as const,
  amountCents: 12_000,
  source: { year: 2025, month: 12 },
};
const income = {
  kind: "opening-balance-income",
  name: "Revenu antérieur" as const,
  amountCents: 4_500,
  source: { year: 2025, month: 12 },
};
const points = Array.from({ length: 12 }, (_, index) => ({
  month: index + 1,
  exists: index === 0,
  incomeCents: 20_000,
  expenseCents: 10_000,
  remainingCents: 10_000,
  openingBalanceCents: 0,
  balanceCents: 10_000,
  savingsCents: 0,
  debtCents: 0,
  cumulativeSavingsCents: 0,
}));
const series = {
  points,
  expenseByCategory: [],
  totals: { expenseCents: 10_000, savingsCents: 0, debtCents: 0 },
  openingBalanceExpense: debt,
  openingBalanceIncome: income,
};

function renderYearScreenChartProps(start: { year: number; month: number } | null, year: number) {
  const input = JSON.stringify({ start, year, series });
  const directory = mkdtempSync(join(tmpdir(), "year-screen-test-"));
  const loaderPath = join(directory, "tsx-loader.mjs");
  const registerPath = join(directory, "register-tsx-loader.mjs");

  writeFileSync(
    loaderPath,
    `import { readFile } from "node:fs/promises";
     import { createRequire } from "node:module";
     const require = createRequire(process.cwd() + "/package.json");
     const ts = require("typescript");
     export async function load(url, context, nextLoad) {
       if (url.endsWith("/src/actions/stats.ts")) {
         return { format: "module", source: "export async function getYearSeries() { return { ok: true, data: JSON.parse(process.env.YEAR_SCREEN_TEST_INPUT).series }; }", shortCircuit: true };
       }
       if (url.endsWith("/src/actions/preferences.ts")) {
         return { format: "module", source: "export async function getPreferences() { return { ok: true, data: { openingBalanceStart: JSON.parse(process.env.YEAR_SCREEN_TEST_INPUT).start } }; }", shortCircuit: true };
       }
       if (url.endsWith("/src/components/YearCharts.tsx")) {
         return { format: "module", source: "import { createElement } from 'react'; export function YearCharts(props) { const value = Buffer.from(JSON.stringify({ openingBalanceDebt: props.openingBalanceDebt, openingBalanceIncome: props.openingBalanceIncome, openingBalanceStart: props.openingBalanceStart })).toString('base64url'); return createElement('output', null, value); }", shortCircuit: true };
       }
       if (!url.endsWith(".tsx")) return nextLoad(url, context);
       const source = await readFile(new URL(url), "utf8");
       return {
         format: "module",
         source: ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText,
         shortCircuit: true,
       };
     }`,
  );
  writeFileSync(
    registerPath,
    `import { register } from "node:module";
     import { pathToFileURL } from "node:url";
     register(pathToFileURL(process.env.YEAR_SCREEN_TSX_LOADER));`,
  );

  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "./tests/helpers/register.mjs",
      "--input-type=module",
      "--import",
      registerPath,
      "--eval",
      `import { renderToStaticMarkup } from "react-dom/server";
       import { YearScreen } from "@/components/YearScreen";
       const input = JSON.parse(process.env.YEAR_SCREEN_TEST_INPUT);
       const markup = renderToStaticMarkup(await YearScreen({ year: input.year }));
       const openingTag = "<output>";
       const start = markup.indexOf(openingTag) + openingTag.length;
       const encoded = markup.slice(start, markup.indexOf("</output>", start));
       process.stdout.write(Buffer.from(encoded, "base64url").toString());`,
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, YEAR_SCREEN_TEST_INPUT: input, YEAR_SCREEN_TSX_LOADER: loaderPath },
    },
  );
  rmSync(directory, { force: true, recursive: true });

  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout) as unknown;
}

test("YearScreen transmet les props analytiques de YearCharts seulement apres l'annee de depart", () => {
  for (const { start, year, expected } of [
    {
      start: null,
      year: 2027,
      expected: { openingBalanceDebt: null, openingBalanceIncome: null, openingBalanceStart: null },
    },
    {
      start: { year: 2026, month: 9 },
      year: 2025,
      expected: {
        openingBalanceDebt: null,
        openingBalanceIncome: null,
        openingBalanceStart: { year: 2026, month: 9 },
      },
    },
    {
      start: { year: 2026, month: 9 },
      year: 2026,
      expected: {
        openingBalanceDebt: null,
        openingBalanceIncome: null,
        openingBalanceStart: { year: 2026, month: 9 },
      },
    },
    {
      start: { year: 2026, month: 9 },
      year: 2027,
      expected: {
        openingBalanceDebt: debt,
        openingBalanceIncome: income,
        openingBalanceStart: { year: 2026, month: 9 },
      },
    },
  ] as const) {
    assert.deepEqual(renderYearScreenChartProps(start, year), expected);
  }
});
