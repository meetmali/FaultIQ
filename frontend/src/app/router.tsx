/* eslint-disable react-refresh/only-export-components -- route table: lazy pages and the router
   factory live together on purpose; this file has no state for Fast Refresh to keep. */
import { lazy, Suspense, type ReactNode } from "react";
import { createBrowserRouter, Link } from "react-router";

import { Loading } from "../components/QueryState";
import { Layout } from "./Layout";

// Each screen loads lazily, so the first page stays small (ADR 0008). Every route serves both
// personas; the page picks the Operator or Technician version (ADR 0026).
const HomePage = lazy(() => import("../pages/HomePage"));
const UnitsPage = lazy(() => import("../pages/UnitsPage"));
const UnitPage = lazy(() => import("../pages/UnitPage"));
const LibraryPage = lazy(() => import("../pages/LibraryPage"));
const LibraryEntryPage = lazy(() => import("../pages/LibraryEntryPage"));
const ModelsPage = lazy(() => import("../pages/ModelsPage"));

const page = (el: ReactNode) => <Suspense fallback={<Loading />}>{el}</Suspense>;

function NotFound() {
  return (
    <div className="space-y-2">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="text-sm text-muted">
        That page doesn't exist. <Link to="/" className="text-accent underline">Go to the home page</Link>.
      </p>
    </div>
  );
}

export const routes = [
  {
    element: <Layout />,
    children: [
      { index: true, element: page(<HomePage />) },
      { path: "units", element: page(<UnitsPage />) },
      { path: "equipment/:equipmentId", element: page(<UnitPage />) },
      { path: "library", element: page(<LibraryPage />) },
      { path: "library/:faultId", element: page(<LibraryEntryPage />) },
      { path: "models", element: page(<ModelsPage />) },
      { path: "*", element: <NotFound /> },
    ],
  },
];

export const createRouter = () => createBrowserRouter(routes);
