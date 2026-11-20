'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { clearSession, getUser, User } from '@/lib/api';

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const u = getUser();
    if (!u) router.replace('/login');
    else setUser(u);
  }, [router]);

  if (!user) return null;

  return (
    <main style={{ padding: 24 }}>
      <h1>Halo, {user.name}</h1>
      <p>Peran: {user.role}</p>
      <button
        onClick={() => {
          clearSession();
          router.replace('/login');
        }}
      >
        Keluar
      </button>
    </main>
  );
}