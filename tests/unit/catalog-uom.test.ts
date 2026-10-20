import { catalogUomLookup } from "@/lib/utils/catalogUom";

describe("Item List UoM lookup", () => {
  const rows = [
    { item_name: "GREEN TEA 200 GRAMS", uom: "PACK/S", departments: "HR" },
    { item_name: "BOND PAPER", uom: "REAM/S", departments: null },
    { item_name: "TISSUE TOWEL", uom: "ROLL/S", departments: null },
    { item_name: "TISSUE TOWEL", uom: "PACK/S", departments: "" },
    { item_name: "GLOVES", uom: "PAIR/S", departments: "QA" },
    { item_name: "GLOVES", uom: "BOX/ES", departments: "ENGG, HR" },
  ];

  it("returns the catalog UoM for an exact name match, ignoring case and spacing", () => {
    const lookup = catalogUomLookup(rows, "HR");
    expect(lookup("GREEN TEA 200 GRAMS")).toBe("PACK/S");
    expect(lookup("  green tea 200 grams ")).toBe("PACK/S");
    expect(lookup("BOND PAPER")).toBe("REAM/S");
  });

  it("leaves names that are not in the catalog to the requester", () => {
    expect(catalogUomLookup(rows, "HR")("GREEN TEA")).toBeUndefined();
  });

  it("ignores entries restricted to other departments", () => {
    expect(catalogUomLookup(rows, "ACCTG")("GREEN TEA 200 GRAMS")).toBeUndefined();
    expect(catalogUomLookup(rows, "hr")("GLOVES")).toBe("BOX/ES");
    expect(catalogUomLookup(rows, "QA")("GLOVES")).toBe("PAIR/S");
  });

  it("does not pick a side when duplicate entries disagree", () => {
    expect(catalogUomLookup(rows, "HR")("TISSUE TOWEL")).toBeUndefined();
  });
});
