// [MS-PPT]'s glossary: "master unit: A unit of linear measurement that is equal to 1/576 inch." A point is 1/72 inch, so eight master units make one point -- the constant is derived from those two definitions rather than stated anywhere as a ratio. https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/ef463dad-817f-4790-9a50-19783cd08827
const MASTER_UNITS_PER_INCH = 576;
export const POINTS_PER_INCH = 72;
export const MASTER_UNITS_PER_POINT = MASTER_UNITS_PER_INCH / POINTS_PER_INCH;

export function masterUnitsToPoints(masterUnits: number): number {
  return masterUnits / MASTER_UNITS_PER_POINT;
}
