import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import DateRangeFilter from "@/components/forms/DateRangeFilter";
import ListToolbar from "@/components/tables/ListToolbar";
import AttachmentDropzone from "@/features/requests/components/AttachmentDropzone";
import SearchableCombobox from "@/components/forms/SearchableCombobox";

// ClientApp keeps several visited screens mounted at once, so the same form
// controls render more than once in one document.
function renderTwice(element: React.ReactElement): string {
  return renderToStaticMarkup(
    <>
      {element}
      {element}
    </>
  );
}

function ids(html: string): string[] {
  return [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
}

const noop = () => {};

describe("form field ids stay unique when a screen is rendered twice", () => {
  it.each([
    ["DateRangeFilter", <DateRangeFilter key="d" />],
    ["ListToolbar", <ListToolbar key="l" searchQuery="" onSearchChange={noop} searchPlaceholder="Search" onExport={noop} />],
    ["AttachmentDropzone", <AttachmentDropzone key="a" id="create-item-attachment" onFileSelected={noop} />],
    ["SearchableCombobox", <SearchableCombobox key="s" value="" onChange={noop} options={[]} />],
  ])("%s", (_name, element) => {
    const found = ids(renderTwice(element));
    expect(found.length).toBeGreaterThan(0);
    expect(new Set(found).size).toBe(found.length);
  });

  it("DateRangeFilter labels point at their own inputs and inputs have names", () => {
    const html = renderToStaticMarkup(<DateRangeFilter />);
    const labelTargets = [...html.matchAll(/<label for="([^"]+)"/g)].map((match) => match[1]);
    expect(labelTargets).toHaveLength(2);
    for (const target of labelTargets) expect(html).toContain(`id="${target}"`);
    expect(html).toContain('name="start_date"');
    expect(html).toContain('name="end_date"');
  });
});
