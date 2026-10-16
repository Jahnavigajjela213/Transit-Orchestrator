import { BarChart3, Bell, ClipboardList, Eye, FlaskConical, GitBranch, ShieldCheck, Target, Wrench, type LucideIcon } from "lucide-react";
import type { Role } from "./types";

export interface ModuleItem { to: string; label: string; icon: LucideIcon; badge?: boolean; roles?: Role[] }

// The module rail of the concepts canvas: every module is always listed as an icon; expanding adds the names.
// `roles` narrows who sees the item at all — omit it and every role sees it. This is a clarity filter, not a
// security boundary: every action these pages lead to is still checked server-side by role (policy edits,
// work-order start/close, approval decisions), so hiding a module here only keeps a role's rail to what's theirs.
export const moduleGroups: ModuleItem[][] = [
  [
    { to: "/", label: "Dashboard", icon: BarChart3 },
    { to: "/attention", label: "Needs your attention", icon: Bell, badge: true, roles: ["dispatcher", "shop_manager", "admin"] },
    { to: "/workflows", label: "Orchestrations", icon: GitBranch },
    { to: "/work-orders", label: "Maintenance", icon: Wrench, roles: ["dispatcher", "shop_manager", "admin"] },
  ],
  [
    { to: "/policies", label: "Autonomy policy", icon: ShieldCheck, roles: ["admin"] },
    { to: "/shadow", label: "Shadow mode", icon: Eye, roles: ["admin", "dispatcher"] },
    { to: "/measures", label: "Pilot measures", icon: Target },
    { to: "/audit", label: "Audit log", icon: ClipboardList },
  ],
  [{ to: "/simulate", label: "Simulate", icon: FlaskConical, roles: ["dispatcher", "shop_manager", "admin"] }],
];

export const moduleItems = moduleGroups.flat();

export function visibleModules(role: Role | undefined): ModuleItem[][] {
  return moduleGroups.map((g) => g.filter((it) => !it.roles || (role && it.roles.includes(role)))).filter((g) => g.length > 0);
}

/** Whether `role` has `path` on its own rail — the only test a dashboard footer link should pass before it
 *  points at a page, so a role is never handed a link to a module it cannot even see in its own menu. */
export function hasModule(role: Role | undefined, path: string): boolean {
  return moduleItems.some((it) => it.to === path && (!it.roles || (role && it.roles.includes(role))));
}

/** Which full page, if any, a panel's subject lives on — used only to label a "More views" launcher card with
 *  where to find the full version, and only when the viewing role actually has that page. */
const PANEL_MODULE: Record<string, string> = {
  escalations: "/attention", "shop-approvals": "/attention", "in-motion": "/workflows", "orchestration-outcomes": "/workflows",
  "work-orders": "/work-orders", "shadow-comparisons": "/shadow", "audit-recent": "/audit",
  "pilot-measures": "/measures", "persona-matrix": "/policies",
};

export function panelModuleTag(key: string, role: Role | undefined): { label: string; icon: ModuleItem["icon"] } | null {
  const path = PANEL_MODULE[key];
  if (!path || !hasModule(role, path)) return null;
  const item = moduleItems.find((m) => m.to === path);
  return item ? { label: item.label, icon: item.icon } : null;
}

/** The full-page link path for a panel, or null when the role has no such page — pass straight to `FullPageLink`. */
export function panelFullPageLink(key: string, role: Role | undefined): string | null {
  const path = PANEL_MODULE[key];
  return path && hasModule(role, path) ? path : null;
}

/** Stamps each launcher card with its module tag (icon + name of the full page it lives on), when the viewing
 *  role actually has that page — so "More views" teaches people where things live instead of just listing panels. */
export function withModuleTags<T extends { key: string }>(cards: T[], role: Role | undefined): (T & { moduleLabel?: string; moduleIcon?: ModuleItem["icon"] })[] {
  return cards.map((c) => {
    const tag = panelModuleTag(c.key, role);
    return tag ? { ...c, moduleLabel: tag.label, moduleIcon: tag.icon } : c;
  });
}
