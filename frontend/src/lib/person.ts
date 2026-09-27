import { useSyncExternalStore } from "react";
import { useLocalSearchParams } from "expo-router";

/**
 * Matches the backend's DEFAULT_PERSON default (backend/src/people.ts): the
 * owner of every file at the top of data/gpx/, and where old single-user web
 * URLs redirect.
 */
export const DEFAULT_PERSON = "mark";

const PERSON_KEY = "gpx-report-person";
const listeners = new Set<() => void>();

/**
 * The phone's "Your name" from Settings — who its recordings and History
 * belong to. Null until set; recording is blocked until then.
 */
export function getPerson() {
  return localStorage.getItem(PERSON_KEY);
}

export function setPerson(name: string) {
  if (name.trim()) localStorage.setItem(PERSON_KEY, name.trim());
  else localStorage.removeItem(PERSON_KEY);
  listeners.forEach((l) => l());
}

export function usePerson() {
  return useSyncExternalStore((l) => {
    listeners.add(l);
    return () => listeners.delete(l);
  }, getPerson);
}

/**
 * The name as the server stores it in `owner` and /<person>/ URLs: same as
 * slugifyPerson in backend/src/people.ts, so "Mark" matches "mark".
 */
export function personSlug(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/** Web: prefixes an app path with the /<person>/ the current page is under. */
export function usePersonHref() {
  const { person } = useLocalSearchParams<{ person: string }>();
  return (path: string) => `/${person}${path}`;
}
