import { Component, type ReactNode } from "react";
import { Routes, Route, Link } from "react-router-dom";
import Landing, { marketingPaths } from "./Landing";
import AuthPage from "./AuthPage";
import Workspace from "./Workspace";
class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <div className="empty">
          <h1>Something interrupted the workspace.</h1>
          <p>
            Reload the page to reconnect. Your saved records stay on the server.
          </p>
          <button className="button orange" onClick={() => location.reload()}>
            Reload workspace
          </button>
        </div>
      );
    return this.props.children;
  }
}
export default function App() {
  return (
    <ErrorBoundary>
      <Routes>
        {marketingPaths.map((path) => (
          <Route key={path} path={path} element={<Landing />} />
        ))}
        {["login", "signup", "forgot", "reset", "verify"].map((path) => (
          <Route key={path} path={`/${path}`} element={<AuthPage />} />
        ))}
        <Route path="/app" element={<Workspace />} />
        <Route path="/app/:section" element={<Workspace />} />
        <Route
          path="*"
          element={
            <div className="empty">
              <h1>This page isn’t on the map.</h1>
              <Link className="button orange" to="/">
                Back to Clearance
              </Link>
            </div>
          }
        />
      </Routes>
    </ErrorBoundary>
  );
}
