import "leaflet/dist/leaflet.css";
import "@/web.css";

import { ApolloProvider } from "@apollo/client";
import { Slot, usePathname } from "expo-router";
import { Link } from "@/components/web-link";
import { useUploadQueueTriggers } from "@/hooks/use-upload-queue-triggers";
import { apolloClient } from "@/lib/apollo";
import { NotificationsProvider } from "@/utils/notifications";
import { UnitsProvider, useUnits } from "@/utils/units";
import { ThemeProvider, useTheme } from "@/utils/web-theme";

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/heatmap", label: "Heatmap" },
  { href: "/record", label: "Record" },
  { href: "/stats", label: "Stats" },
  { href: "/settings", label: "Settings" },
  { href: "/code", label: "Code" },
];

function Shell() {
  const pathname = usePathname();
  const isCode = pathname === "/code";
  const { unit, setUnit } = useUnits();
  const { theme, toggleTheme } = useTheme();
  useUploadQueueTriggers();

  return (
    <div className="app-shell">
      <nav className="nav">
        {NAV.map(({ href, label }) => (
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
