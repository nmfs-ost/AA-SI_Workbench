/**
 * Where this Workbench is reached (backend api/address.py): on a Cloud
 * Workstation, https://<port>-<workstation host>/, the same every time the
 * workstation starts; and the tunnel that makes it http://localhost:<port> on
 * the user's own computer.
 */

const API_BASE = import.meta.env.VITE_AASI_API_BASE ?? '';

export interface Address {
  workstation: boolean;
  webHost: string;
  name: string;
  port: number;
  url: string;
  tunnel: string;
  localUrl: string;
}

export async function getAddress(): Promise<Address> {
  const response = await fetch(`${API_BASE}/api/address`, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return (await response.json()) as Address;
}

/** The address without Cloud Workstations' one-time sign-in token. */
export function withoutSignInToken(href: string): string {
  try {
    const url = new URL(href);
    if (!url.searchParams.has('_workstationAccessToken')) return href;
    url.searchParams.delete('_workstationAccessToken');
    return url.toString();
  } catch {
    return href;
  }
}
