import { describe, expect, it } from "vitest";
import { parseNumber } from "../src/shared/number";

// 2026-11-25: the old reader dropped every space and comma and read the first run of digits, so "12,50 €" was 1250,
// "1.234,56 €" was 1.234, "−5 °C" was 5 and "10 20" was 1020: wrong numbers, returned as a success.
describe("parseNumber: the number a person reads in the text, or nothing", () => {
  const cases: [string, number | null][] = [
    // plain and English-style grouping
    ["42", 42],
    ["£1,234.56", 1234.56],
    ["1,234,567", 1234567],
    ["$0.99", 0.99],
    ["12.5%", 12.5],
    ["Price: £10 (was £12)", 10],
    ["3 left in stock", 3],
    // Indian grouping (lakh, crore)
    ["₹12,34,567.50", 1234567.5],
    ["1,23,456", 123456],
    ["1,00,00,000", 10000000],
    // a decimal comma (most of Europe)
    ["12,50 €", 12.5],
    ["0,25", 0.25],
    ["1.234,56 €", 1234.56],
    ["1.234.567", 1234567],
    // spaces and apostrophes as grouping (French, Swiss), including no-break spaces
    ["1 234 567", 1234567],
    ["1 234,50 €", 1234.5],
    ["1 234", 1234],
    ["CHF 1'234.50", 1234.5],
    ["CHF 1’234.50", 1234.5],
    ["$.99", 0.99],
    ["v2.5", 2.5],
    // two numbers next to each other are not one number
    ["10 20", 10],
    ["Rated 4 of 5", 4],
    // ambiguous, read as in English (known limitation): a page that means 1.25 or 1234 here gets the other number
    ["1,250", 1250],
    ["1.234", 1.234],
    // signs
    ["-7", -7],
    ["−5 °C", -5],
    ["Balance: -12.30", -12.3],
    ["Order A-12", 12],
    ["-.5", -0.5],
    ["3–5 days", 3],
    // unclear or no number: nothing, so the tool reports it cannot read a number instead of guessing
    ["1,2,3", null],
    ["1,23,4", null],
    ["1.234,5.6", null],
    ["no digits here", null],
    ["", null],
  ];
  for (const [text, want] of cases) it(`${JSON.stringify(text)} → ${want}`, () => expect(parseNumber(text)).toBe(want));
});
