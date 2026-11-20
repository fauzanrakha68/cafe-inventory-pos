"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Boxes,
  ChevronDown,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  ReceiptText,
  UtensilsCrossed,
  X,
  type LucideIcon,
} from "lucide-react";
import Logo from "@/components/Logo";
import { clearSession, getUser, type Role, type User } from "@/lib/api";

const NAV: { href: string; label: string; icon: LucideIcon; roles: Role[] }[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ["admin", "kasir", "store_keeper"] },
  { href: "/ingredients", label: "Bahan", icon: Package, roles: ["admin", "store_keeper"] },
  { href: "/stock", label: "Stok", icon: Boxes, roles: ["admin", "store_keeper"] },
  { href: "/menus", label: "Menu", icon: UtensilsCrossed, roles: ["admin"] },
  { href: "/pos", label: "Kasir", icon: ReceiptText, roles: ["admin", "kasir"] },
];

const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  kasir: "Kasir",
  store_keeper: "Store keeper",
};

const COLLAPSE_KEY = "sidebar_collapsed";

function SidebarContent({
  role,
  pathname,
  collapsed = false,
  onNavigate,
}: {
  role: Role;
  pathname: string;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <>
      <div
        className={`flex h-14 shrink-0 items-center gap-2.5 border-b border-line ${
          collapsed ? "justify-center" : "px-5"
        }`}
      >
        <Logo />
        {!collapsed && (
          <span className="font-display text-lg font-semibold leading-tight tracking-tight text-ink">
            Cafe Inventory POS
          </span>
        )}
      </div>

      <nav className={`flex-1 space-y-1 overflow-y-auto py-3 ${collapsed ? "px-2" : "px-3"}`}>
        {NAV.filter((n) => n.roles.includes(role)).map((n) => {
          const active = pathname === n.href;
          const Icon = n.icon;
          return (
            <Link
              key={n.href}
              href={n.href}
              onClick={onNavigate}
              title={collapsed ? n.label : undefined}
              aria-label={n.label}
              className={`flex items-center rounded-md py-2 text-sm font-medium ${
                collapsed ? "justify-center" : "gap-2.5 px-3"
              } ${active ? "bg-highlight text-ink" : "text-muted hover:bg-paper hover:text-ink"}`}
            >
              <Icon size={18} />
              {!collapsed && n.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}

function ProfileMenu({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const initials =
    user.name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0].toUpperCase())
      .join("") || "?";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-md py-1 pl-1 pr-2 hover:bg-paper"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-highlight text-sm font-semibold text-ink">
          {initials}
        </span>
        <span className="hidden text-left sm:block">
          <span className="block text-sm font-medium leading-tight text-ink">{user.name}</span>
          <span className="block text-xs leading-tight text-muted">{ROLE_LABEL[user.role]}</span>
        </span>
        <ChevronDown size={16} className="text-muted" />
      </button>

      {open && (
        <div role="menu" className="absolute right-0 mt-2 w-64 overflow-hidden rounded-md border border-line bg-white shadow-lg">
          <div className="border-b border-line px-4 py-3">
            <p className="truncate text-sm font-medium text-ink">{user.name}</p>
            <p className="truncate text-sm text-muted">{user.email}</p>
            <span className="mt-2 inline-block rounded-sm bg-highlight px-2 py-0.5 text-xs font-medium text-ink">
              {ROLE_LABEL[user.role]}
            </span>
          </div>
          <button
            role="menuitem"
            onClick={onLogout}
            className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm font-medium text-ink hover:bg-paper"
          >
            <LogOut size={16} /> Keluar
          </button>
        </div>
      )}
    </div>
  );
}

export default function AppShell({
  title,
  description,
  roles,
  children,
}: {
  title: string;
  description?: string;
  roles?: Role[];
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [open, setOpen] = useState(false);
  const rolesKey = roles?.join(",") ?? "";

  useEffect(() => {
    const u = getUser();
    if (!u) {
      router.replace("/login");
      return;
    }
    if (rolesKey && !rolesKey.split(",").includes(u.role)) {
      router.replace("/dashboard");
      return;
    }
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      /* abaikan */
    }
    setUser(u);
  }, [router, rolesKey]);

  if (!user) return null;

  function logout() {
    clearSession();
    router.replace("/login");
  }

  function toggleSidebar() {
    if (window.matchMedia("(min-width: 768px)").matches) {
      setCollapsed((c) => {
        const next = !c;
        try {
          localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
        } catch {
          /* abaikan */
        }
        return next;
      });
    } else {
      setOpen(true);
    }
  }

  return (
    <div className="min-h-screen bg-paper">
      {/* sidebar desktop */}
      <aside
        className={`fixed inset-y-0 left-0 z-20 hidden flex-col border-r border-line bg-white transition-[width] duration-200 md:flex ${
          collapsed ? "w-16" : "w-64"
        }`}
      >
        <SidebarContent role={user.role} pathname={pathname} collapsed={collapsed} />
      </aside>

      {/* laci menu di layar kecil */}
      {open && (
        <div className="fixed inset-0 z-30 md:hidden">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-white shadow-xl">
            <button
              type="button"
              aria-label="Tutup menu"
              onClick={() => setOpen(false)}
              className="absolute right-2 top-2.5 rounded-md p-2 text-muted hover:bg-paper hover:text-ink"
            >
              <X size={18} />
            </button>
            <SidebarContent role={user.role} pathname={pathname} onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}

      <div className={`transition-[padding] duration-200 ${collapsed ? "md:pl-16" : "md:pl-64"}`}>
        {/* navbar atas */}
        <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-line bg-white px-4 md:px-8">
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Ciutkan atau lebarkan menu"
              onClick={toggleSidebar}
              className="rounded-md p-2 text-muted hover:bg-paper hover:text-ink"
            >
              <Menu size={20} className="md:hidden" />
              <span className="hidden md:inline">
                {collapsed ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}
              </span>
            </button>
            <span className="font-display text-lg font-semibold tracking-tight text-ink md:hidden">
              Cafe Inventory POS
            </span>
          </div>
          <ProfileMenu user={user} onLogout={logout} />
        </header>

        <main className="w-full px-4 py-8 md:px-8">
          <div className="mb-5">
            <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">{title}</h1>
            {description && <p className="mt-1 text-sm text-muted">{description}</p>}
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}