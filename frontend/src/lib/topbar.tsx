import { createContext, useContext, useEffect } from "react";

/** The page's place in the top bar: "Orchestrations › P-210". The last crumb is the page itself. */
export interface Crumb { label: string; to?: string }

export const CrumbsContext = createContext<(crumbs: Crumb[] | null) => void>(() => {});

/** A page names itself in the top bar beyond its menu name (e.g. the vehicle on an orchestration's page). */
export function useCrumbs(crumbs: Crumb[] | null) {
  const set = useContext(CrumbsContext);
  const key = JSON.stringify(crumbs);
  useEffect(() => {
    set(crumbs);
    return () => set(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
