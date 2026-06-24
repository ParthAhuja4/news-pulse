"use client";

// Small fetch wrapper so every call uses the same base URL + error handling.

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export async function apiGet(path) {
  const res = await fetch(`${API_URL}${path}`, { cache: "no-store" });
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.json()).error || "";
    } catch {
      /* ignore body parse failure */
    }
    throw new Error(`${res.status} ${res.statusText}${detail ? ` — ${detail}` : ""}`);
  }
  return res.json();
}

export async function apiPost(path) {
  const res = await fetch(`${API_URL}${path}`, { method: "POST" });
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.json()).error || "";
    } catch {
      /* ignore */
    }
    throw new Error(`${res.status} ${res.statusText}${detail ? ` — ${detail}` : ""}`);
  }
  return res.json();
}
