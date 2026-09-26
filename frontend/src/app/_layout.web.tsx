import "leaflet/dist/leaflet.css";
import "@/web.css";

import { useState } from "react";
import { ApolloProvider } from "@apollo/client";
import { Slot, useGlobalSearchParams, usePathname } from "expo-router";
import { Link } from "@/components/web-link";
import { useUploadQueueTriggers } from "@/hooks/use-upload-queue-triggers";
import { apolloClient } from "@/lib/apollo";
import { DEFAULT_PERSON } from "@/lib/person";
import { NotificationsProvider } from "@/utils/notifications";
import { UnitsProvider, useUnits } from "@/utils/units";
import { ThemeProvider, useTheme } from "@/utils/web-theme";

// Paths under /<person>/; Code is global.
const PERSON_NAV = [
  { path: "", label: "Dashboard" },
  { path: "/heatmap", label: "Heatmap" },
  { path: "/record", label: "Record" },
  { path: "/stats", label: "Stats" },
  { path: "/settings", label: "Settings" },
];

function Shell() {
  const pathname = usePathname();
  // Pages outside /<person>/ (the picker, Code) keep linking to whoever was
  // viewed last.
  const { person: routePerson } = useGlobalSearchParams<{ person?: string }>();
  const [lastPerson, setLastPerson] = useState(DEFAULT_PERSON);
  if (routePerson && routePerson !== lastPerson) setLastPerson(routePerson);
  const person = routePerson ?? lastPerson;
  const nav = [
    ...PERSON_NAV.map(({ path, label }) => ({ href: `/${person}${path}`, label })),
    { href: "/code", label: "Code" },
  ];
  const isCode = pathname === "/code";
  const { unit, setUnit } = useUnits();
  const { theme, toggleTheme } = useTheme();
  useUploadQueueTriggers();

  return (
    <div className="app-shell">
      <nav className="nav">
        <Link to="/" className="nav-person" title="Switch person">
          {person} ▾
        </Link>
        {nav.map(({ href, label }) => (
          <Link key={href} to={href} className={pathname === href ? "active" : undefined}>
            {label}
          </Link>
        ))}
        <button
          className="units-toggle"
          onClick={() => setUnit(unit === "imperial" ? "metric" : "imperial")}
        >
          {unit === "imperial" ? "mi/ft" : "km/m"}
        </button>
        <button className="theme-toggle" onClick={toggleTheme} aria-label="Toggle light/dark mode">
          {theme === "dark" ? "☀️" : "🌙"}
        </button>
      </nav>
      <main className={isCode ? "content content-full" : "content"}>
        <Slot />
      </main>
    </div>
  );
}

export default function RootLayout() {
  return (
    <ApolloProvider client={apolloClient}>
      <ThemeProvider>
        <UnitsProvider>
          <NotificationsProvider>
            <Shell />
          </NotificationsProvider>
        </UnitsProvider>
      </ThemeProvider>
    </ApolloProvider>
  );
}
