import { Routes, Route, NavLink, useLocation } from "react-router-dom";
import Dashboard from "./pages/Dashboard.jsx";
import ActivityDetail from "./pages/ActivityDetail.jsx";
import Stats from "./pages/Stats.jsx";
import Settings from "./pages/Settings.jsx";
import CodeEditor from "./pages/CodeEditor.jsx";
import { useUnits } from "./units.jsx";

export default function App() {
  const { pathname } = useLocation();
  const isCode = pathname === "/code";
  const { unit, setUnit } = useUnits();

  return (
    <div className="app-shell">
      <nav className="nav">
        <NavLink to="/" end className={({ isActive }) => (isActive ? "active" : undefined)}>
          Dashboard
        </NavLink>
        <NavLink to="/stats" className={({ isActive }) => (isActive ? "active" : undefined)}>
          Stats
        </NavLink>
        <NavLink to="/settings" className={({ isActive }) => (isActive ? "active" : undefined)}>
          Settings
        </NavLink>
        <NavLink to="/code" className={({ isActive }) => (isActive ? "active" : undefined)}>
          Code
        </NavLink>
        <button
          className="units-toggle"
          onClick={() => setUnit(unit === "imperial" ? "metric" : "imperial")}
        >
          {unit === "imperial" ? "mi/ft" : "km/m"}
        </button>
      </nav>
      <main className={isCode ? "content content-full" : "content"}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/activities/:id" element={<ActivityDetail />} />
          <Route path="/stats" element={<Stats />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/code" element={<CodeEditor />} />
        </Routes>
      </main>
    </div>
  );
}
