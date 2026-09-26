import "leaflet/dist/leaflet.css";
import "@/web.css";

import { useState } from "react";
import { ApolloProvider } from "@apollo/client";
import { Slot, useGlobalSearchParams, usePathname } from "expo-router";
import { Link } from "@/components/web-link";
import { apolloClient } from "@/lib/apollo";
import { DEFAULT_PERSON } from "@/lib/person";
import { NotificationsProvider } from "@/utils/notifications";
import { UnitsProvider, useUnits } from "@/utils/units";
import { ThemeProvider, useTheme } from "@/utils/web-theme";

const PERSON_NAV = [
  { path: "", label: "Dashboard" },
  { path: "/heatmap", label: "Heatmap" },
  { path: "/stats", label: "Stats" },
  { path: "/settings", label: "Settings" },
];

function Shell() {
  // The phone app shows activity pages in a WebView with ?embed=1, where its
  // own title bar replaces this nav. Read once so it survives in-page links.
  const [embedded] = useState(() => new URLSearchParams(window.location.search).has("embed"));
  const pathname = usePathname();
  // Pages outside /<person>/ (the picker) keep linking to whoever was viewed
  // last.
  const { person: routePerson } = useGlobalSearchParams<{ person?: string }>();
  const [lastPerson, setLastPerson] = useState(DEFAULT_PERSON);
  if (routePerson && routePerson !== lastPerson) setLastPerson(routePerson);
  const person = routePerson ?? lastPerson;
  const nav = PERSON_NAV.map(({ path, label }) => ({ href: `/${person}${path}`, label }));
  const { unit, setUnit } = useUnits();
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="app-shell">
      {!embedded && (
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
          <button
            className="theme-toggle"
            onClick={toggleTheme}
            aria-label="Toggle light/dark mode"
          >
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
        </nav>
      )}
      <main className="content">
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
