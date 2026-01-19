import { MOON_CATALOG } from "./catalog";
import type { Mode, MoonClass, PrecisionClass } from "./types";

export const INNER_MOONS = ["IO", "EUROPA", "GANYMEDE", "CALLISTO"];

export const AMALTHEA_GROUP = ["METIS", "ADRASTEA", "AMALTHEA", "THEBE"];

export const REGULAR_MOONS = [
  ...INNER_MOONS,
  ...AMALTHEA_GROUP,
  "HIMALIA",
  "ELARA",
  "PASIPHAE",
  "SINOPE",
  "LYSITHEA",
  "CARME",
  "ANANKE",
  "LEDA",
  "THEMISTO"
];

export const IRREGULAR_MOONS = [
  "CALLIRRHOE",
  "MEGACLITE",
  "TAYGETE",
  "CHALDENE",
  "HARPALYKE",
  "KALYKE",
  "IOCASTE",
  "ERINOME",
  "ISONOE",
  "PRAXIDIKE",
  "ORTHOSIE",
  "THYONE",
  "KALE",
  "AUTONOE",
  "EUKELADE",
  "MNEME",
  "AEDE",
  "THELXINOE",
  "ARCHE",
  "S/2022_J_1"
];

export function targetsForMode(mode: Mode) {
  if (mode === "inner") return INNER_MOONS;
  if (mode === "regular") return REGULAR_MOONS;
  return [...REGULAR_MOONS, ...IRREGULAR_MOONS];
}

export function classForTarget(key: string): MoonClass {
  return MOON_CATALOG[key]?.class ?? "regular";
}

export function precisionForTarget(key: string): PrecisionClass {
  const moonClass = classForTarget(key);
  if (moonClass === "irregular") return "hourly";
  return "high";
}
