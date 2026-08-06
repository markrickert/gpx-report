import { Routes, Route, Link, useLocation } from "react-router-dom";
import Dashboard from "./pages/Dashboard.jsx";
import ActivityDetail from "./pages/ActivityDetail.jsx";
import Settings from "./pages/Settings.jsx";
import CodeEditor from "./pages/CodeEditor.jsx";

export default function App() {
  const { pathname } = useLocation();
  const isCode = pathname === "/code";

  return (
    <div className="app-shell">
      <nav className="nav">
        <Link to="/">Dashboard</Link>
        <Link to="/settings">Settings</Link>
        <Link to="/code">Code</Link>
      </nav>
      <main className={isCode ? "content content-full" : "content"}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/activities/:id" element={<ActivityDetail />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/code" element={<CodeEditor />} />
        </Routes>
      </main>
    </div>
  );
}
