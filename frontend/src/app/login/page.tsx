"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import Logo from "@/components/Logo";
import { api, saveSession, type User } from "@/lib/api";
import { btnPrimary, inputCls } from "@/lib/ui";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data = await api<{ token: string; user: User }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      saveSession(data.token, data.user);
      router.replace("/dashboard");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-4">
      <div className="w-full max-w-sm rounded-xl border border-line bg-white p-6 shadow-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <Logo />
          <h1 className="font-display text-lg font-semibold tracking-tight text-ink">Cafe Inventory POS</h1>
        </div>
        <h2 className="mb-4 font-display text-xl font-semibold tracking-tight text-ink">Masuk</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm text-muted" htmlFor="email">Email</label>
            <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={`w-full ${inputCls}`} />
          </div>
          <div>
            <label className="mb-1 block text-sm text-muted" htmlFor="password">Password</label>
            <input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className={`w-full ${inputCls}`} />
          </div>

          {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}

          <button type="submit" disabled={loading} className={`w-full ${btnPrimary}`}>
            {loading && <Loader2 size={16} className="animate-spin" />}
            Masuk
          </button>
        </form>
      </div>
    </main>
  );
}