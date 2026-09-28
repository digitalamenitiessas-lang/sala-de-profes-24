// ---------------------------------------------------------------------------
// Reusable SWR fetchers
// ---------------------------------------------------------------------------

/**
 * Standard fetcher for API routes — throws on non-OK responses.
 */
export async function apiFetcher<T = unknown>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error ?? `Error ${res.status}`)
  }
  return res.json()
}
