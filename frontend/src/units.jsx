import { createContext, useContext, useEffect, useState } from "react";

const STORAGE_KEY = "gpx-report-units";
const UnitsContext = createContext(null);

export function UnitsProvider({ children }) {
  const [unit, setUnit] = useState(() => localStorage.getItem(STORAGE_KEY) || "imperial");

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, unit);
  }, [unit]);

  return <UnitsContext.Provider value={{ unit, setUnit }}>{children}</UnitsContext.Provider>;
}

export function useUnits() {
  return useContext(UnitsContext);
}

const MI_PER_METER = 0.000621371;
const KM_PER_METER = 0.001;
const FT_PER_METER = 3.28084;

export function formatDistance(meters, unit) {
  const value = unit === "imperial" ? meters * MI_PER_METER : meters * KM_PER_METER;
  return `${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${distanceUnitLabel(unit)}`;
}

export function distanceValue(meters, unit) {
  return unit === "imperial" ? meters * MI_PER_METER : meters * KM_PER_METER;
}

export function distanceUnitLabel(unit) {
  return unit === "imperial" ? "mi" : "km";
}

export function elevationValue(meters, unit) {
  return unit === "imperial" ? meters * FT_PER_METER : meters;
}

export function formatElevation(meters, unit) {
  return meters == null
    ? "-"
    : `${Math.round(elevationValue(meters, unit)).toLocaleString()} ${elevationUnitLabel(unit)}`;
}

export function elevationUnitLabel(unit) {
  return unit === "imperial" ? "ft" : "m";
}

export function formatSpeed(mps, unit) {
  if (mps == null) return "-";
  const kmh = mps * 3.6;
  return unit === "imperial" ? `${(kmh * 0.621371).toFixed(1)} mph` : `${kmh.toFixed(1)} km/h`;
}
