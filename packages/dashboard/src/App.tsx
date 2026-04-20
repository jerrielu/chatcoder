import { Link, Navigate, Route, Routes } from "react-router-dom";
import { SessionsPage } from "./pages/SessionsPage";
import { SessionDetailPage } from "./pages/SessionDetailPage";

export function App(): JSX.Element {
  return (
    <>
      <header>
        <Link to="/sessions">chatcoder dashboard</Link>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Navigate to="/sessions" replace />} />
          <Route path="/sessions" element={<SessionsPage />} />
          <Route path="/sessions/:id" element={<SessionDetailPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </>
  );
}

function NotFound(): JSX.Element {
  return (
    <>
      <h1>Not found</h1>
      <p>
        Try <Link className="link" to="/sessions">/sessions</Link>.
      </p>
    </>
  );
}
