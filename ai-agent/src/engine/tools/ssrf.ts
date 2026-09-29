import dns from "node:dns/promises";
import net from "node:net";

export async function isUrlSafe(targetUrl: string): Promise<boolean> {
  try {
    const parsed = new URL(targetUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }

    const hostname = parsed.hostname;
    if (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".internal")
    ) {
      return false;
    }

    let ip = hostname;
    if (ip.startsWith("[") && ip.endsWith("]")) {
      ip = ip.slice(1, -1);
    }

    if (!net.isIP(ip)) {
      try {
        const lookup = await dns.lookup(hostname);
        ip = lookup.address;
      } catch {
        return false;
      }
    }

    if (isPrivateIP(ip)) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

export function isPrivateIP(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map(Number);
    // 127.0.0.0/8
    if (parts[0] === 127) return true;
    // 10.0.0.0/8
    if (parts[0] === 10) return true;
    // 172.16.0.0/12
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    // 192.168.0.0/16
    if (parts[0] === 192 && parts[1] === 168) return true;
    // 169.254.0.0/16 (Link-local & AWS metadata)
    if (parts[0] === 169 && parts[1] === 254) return true;
    // 0.0.0.0/8
    if (parts[0] === 0) return true;
    // 100.64.0.0/10 (Carrier-grade NAT)
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
    // Multicast & reserved (224.0.0.0+)
    if (parts[0] >= 224) return true;
    return false;
  }

  if (net.isIPv6(ip)) {
    const normalized = ip.toLowerCase();

    // IPv4-mapped IPv6 address (e.g. ::ffff:127.0.0.1 or ::ffff:7f00:1)
    if (normalized.startsWith("::ffff:")) {
      const tail = normalized.slice(7);
      if (tail.includes(".") && net.isIPv4(tail)) {
        return isPrivateIP(tail);
      }
      const hexParts = tail.split(":");
      if (hexParts.length === 2) {
        const high = parseInt(hexParts[0], 16);
        const low = parseInt(hexParts[1], 16);
        if (!isNaN(high) && !isNaN(low)) {
          const v4 = `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
          return isPrivateIP(v4);
        }
      }
      return true;
    }

    // Loopback / unspecified
    if (normalized === "::1" || normalized === "::") return true;

    // fe80::/10 link-local, fc00::/7 unique local (fc... and fd...)
    if (
      normalized.startsWith("fe80:") ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd")
    ) {
      return true;
    }

    // Deprecated IPv4-compatible IPv6 (::... /96)
    if (normalized.startsWith("::")) {
      return true;
    }
  }

  return false;
}
