"use client";

import { type ReactNode, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import Logo from "@/components/Logo";
import { clearSession, getUser, type Role, type User } from "@/lib/api";

const NAV: { href: string; label: string; roles: Role[] }[] = [
  { href: "/dashboard", label: "Dashboard", roles: ["admin", "kasir", "store_keeper"] },
  { href: "/ingredients", label: "Bahan", roles: ["admin", "store_keeper"] },
  { href: "/stock", label: "Stok", roles: ["admin", "store_keeper"] },
];

const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  kasir: "Kasir",
  store_keeper: "Store keeper",
};

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
    setUser(u);
  }, [router, rolesKey]);

  if (!user) return null;

  function logout() {
    clearSession();
    router.replace("/login");
  }

  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex min-h-14 w-full max-w-4xl flex-wrap items-center gap-x-6 gap-y-1 px-4 py-2">
          <div className="flex items-center gap-2.5">
            <Logo />
            <span className="font-display text-lg font-semibold tracking-tight text-ink">Cafe Inventory POS</span>
          </div>
          <nav className="flex flex-1 items-center gap-1">
            {NAV.filter((n) => n.roles.includes(user.role)).map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={`rounded-sm px-2.5 py-1 text-sm font-medium ${
                  pathname === n.href ? "bg-highlight text-ink" : "text-muted hover:text-ink"
                }`}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-4">
            <span className="hidden text-sm text-muted sm:inline">
              {user.name} · {ROLE_LABEL[user.role]}
            </span>
            <button onClick={logout} className="inline-flex items-center gap-1.5 text-sm font-medium text-ink hover:underline">
              <LogOut size={16} /> Keluar
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl px-4 py-8">
        <div className="mb-5">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">{title}</h1>
          {description && <p className="mt-1 text-sm text-muted">{description}</p>}
        </div>
        {children}
      </main>
    </div>
  );
}