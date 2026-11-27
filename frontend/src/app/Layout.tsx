import * as Dialog from "@radix-ui/react-dialog";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { Activity, Check, ChevronDown, HardHat, Monitor, Moon, Sun, UserRound, X, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { NavLink, Outlet } from "react-router";

import { DemoBanner } from "../components/DemoBanner";
import { Badge, Button, inputClass } from "../components/ui";
import { useEquipmentTypes, useHealth, useSites } from "../hooks/queries";
import { cn } from "../lib/cn";
import { usePreferences, type Persona, type ThemeChoice } from "./preferences";

const NAV = [
  { to: "/", label: "Home", end: true },
  { to: "/units", label: "Units", end: false },
  { to: "/work-orders", label: "Work orders", end: false },
  { to: "/library", label: "Fault Library", end: false },
  { to: "/models", label: "Models", end: false },
];

// Shown before the catalogue loads, or if the API can't be reached.
const FALLBACK_TYPES = [{ id: "rtu", name: "Rooftop units", status: "available", description: "" }];

/** Equipment-type switcher: rooftop units now, the rest announced as coming soon (ADR 0026). */
function EquipmentTypeMenu() {
  const types = useEquipmentTypes().data ?? FALLBACK_TYPES;
  const [soon, setSoon] = useState<string | null>(null);
  const current = types.find((t) => t.status === "available") ?? FALLBACK_TYPES[0]!;
  return (
    <>
      <Menu.Root>
        <Menu.Trigger asChild>
          <Button variant="secondary" aria-label={`Equipment type: ${current.name}`}>
            {current.name}
            <ChevronDown aria-hidden="true" className="size-4 text-muted" />
          </Button>
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content align="start" sideOffset={6} className="z-50 min-w-64 rounded-xl border border-line bg-surface p-1 shadow-lg">
            <Menu.Label className="px-2 py-1.5 text-xs font-medium text-muted">Equipment type</Menu.Label>
            {types.map((t) => (
              <Menu.Item
                key={t.id}
                onSelect={() => t.status !== "available" && setSoon(t.name)}
                className="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2 py-2 text-sm text-ink outline-none data-[highlighted]:bg-raised"
              >
                <span className="flex items-center gap-2">
                  {t.status === "available" ? <Check aria-hidden="true" className="size-4 text-accent" /> : <span className="size-4" />}
                  {t.name}
                </span>
                {t.status !== "available" && <Badge className="border-line bg-raised text-muted">Coming soon</Badge>}
              </Menu.Item>
            ))}
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>
      <Dialog.Root open={soon !== null} onOpenChange={(o) => !o && setSoon(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
          <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-line bg-surface p-5 shadow-xl">
            <Dialog.Title className="text-lg font-semibold text-ink">{soon} are coming</Dialog.Title>
            <Dialog.Description className="mt-2 text-sm text-ink-2">
              {soon} diagnostics will be available in a future release. FaultIQ currently supports rooftop units.
            </Dialog.Description>
            <div className="mt-4 flex justify-end">
              <Dialog.Close asChild>
                <Button>Got it</Button>
              </Dialog.Close>
            </div>
            <Dialog.Close asChild>
              <button type="button" aria-label="Close" className="absolute top-3 right-3 rounded p-1 text-muted hover:bg-raised">
                <X aria-hidden="true" className="size-4" />
              </button>
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

/** A segmented control that is a real radio group, so keyboard and screen-reader users get it. */
function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
  iconOnly,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; icon: LucideIcon }[];
  iconOnly?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-xl border border-line bg-raised p-0.5">
      {options.map((o) => {
        const Icon = o.icon;
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={iconOnly ? o.label : undefined}
            title={iconOnly ? o.label : undefined}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => {
              if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
              const i = options.findIndex((x) => x.value === value);
              const next = options[(i + (e.key === "ArrowRight" ? 1 : options.length - 1)) % options.length]!;
              onChange(next.value);
            }}
            tabIndex={active ? 0 : -1}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-sm font-medium transition",
              "focus-visible:outline-2 focus-visible:outline-accent",
              active ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink",
            )}
          >
            <Icon aria-hidden="true" className="size-4" />
            {!iconOnly && o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Layout() {
  const health = useHealth();
  const { persona, setPersona, theme, setTheme, site, setSite } = usePreferences();
  const sites = useSites();

  return (
    <div className="flex min-h-screen flex-col bg-canvas text-ink">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2 focus:shadow"
      >
        Skip to content
      </a>
      {health.data?.demo_mode && <DemoBanner />}
      <header className="border-b border-line bg-surface print:hidden">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3 sm:px-6">
          <NavLink to="/" className="flex items-center gap-2 font-semibold text-ink">
            <Activity aria-hidden="true" className="size-5 text-accent" />
            FaultIQ
          </NavLink>
          <EquipmentTypeMenu />
          <label className="sr-only" htmlFor="site-select">Site</label>
          <select id="site-select" className={inputClass} value={site} onChange={(e) => setSite(e.target.value)}>
            <option value="">All sites</option>
            {sites.data?.map((s) => (
              <option key={s.site} value={s.site}>{s.site}</option>
            ))}
          </select>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Segmented<Persona>
              label="View for"
              value={persona}
              onChange={setPersona}
              options={[
                { value: "operator", label: "Operator", icon: UserRound },
                { value: "technician", label: "Technician", icon: HardHat },
              ]}
            />
            <Segmented<ThemeChoice>
              label="Theme"
              value={theme}
              onChange={setTheme}
              iconOnly
              options={[
                { value: "system", label: "Follow system theme", icon: Monitor },
                { value: "light", label: "Light theme", icon: Sun },
                { value: "dark", label: "Dark theme", icon: Moon },
              ]}
            />
          </div>
        </div>
        <nav aria-label="Main" className="mx-auto max-w-7xl px-4 sm:px-6">
          <ul className="flex gap-1">
            {NAV.map((n) => (
              <li key={n.to}>
                <NavLink
                  to={n.to}
                  end={n.end}
                  className={({ isActive }) =>
                    cn(
                      "inline-block border-b-2 px-3 py-2 text-sm font-medium",
                      isActive ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink",
                    )
                  }
                >
                  {n.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
        <Outlet />
      </main>
      <footer className="border-t border-line bg-surface">
        <div className="mx-auto max-w-7xl px-4 py-4 text-xs text-muted sm:px-6">
          <p>
            <strong className="text-ink-2">Decision support only.</strong> FaultIQ detects and diagnoses faults from
            sensor data. It doesn't control equipment, and its results are inferences for a qualified technician to
            confirm on site.
          </p>
          <p className="mt-1">
            Free and open source under the MIT License · API {health.data?.api_version ?? "…"}
            {health.isError && <span className="text-fault"> · API unreachable</span>}
          </p>
        </div>
      </footer>
    </div>
  );
}
