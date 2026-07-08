import type { CollectionEntry } from "astro:content";

export interface TagLabelSource {
  label: string;
  localized: boolean;
}

export type TagLabelSourceMap = Map<string, TagLabelSource>;
export type TagLabelCandidateMap = Map<string, string[]>;

const SPECIAL_TAG_LABELS: Record<string, string> = {
  ai: "AI",
  api: "API",
  bgp: "BGP",
  cve: "CVE",
  ddos: "DDoS",
  dns: "DNS",
  dnssec: "DNSSEC",
  doh: "DoH",
  ebpf: "eBPF",
  ftp: "FTP",
  gpu: "GPU",
  grpc: "gRPC",
  http2: "HTTP/2",
  http3: "HTTP/3",
  icmp: "ICMP",
  ipfs: "IPFS",
  ipsec: "IPsec",
  ipv4: "IPv4",
  ipv6: "IPv6",
  json: "JSON",
  jwt: "JWT",
  llm: "LLM",
  mqtt: "MQTT",
  mtls: "mTLS",
  ocsp: "OCSP",
  quic: "QUIC",
  rdp: "RDP",
  rpki: "RPKI",
  rsa: "RSA",
  s3: "S3",
  saml: "SAML",
  scim: "SCIM",
  sftp: "SFTP",
  smtp: "SMTP",
  sql: "SQL",
  ssh: "SSH",
  ssl: "SSL",
  sso: "SSO",
  tcp: "TCP",
  tls: "TLS",
  udp: "UDP",
  vpn: "VPN",
  waf: "WAF",
  yaml: "YAML",
};

export function normalizeTagSlug(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function formatTagLabel(value: string): string {
  const slug = normalizeTagSlug(value);
  if (SPECIAL_TAG_LABELS[slug]) return SPECIAL_TAG_LABELS[slug];

  return value
    .trim()
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const wordSlug = normalizeTagSlug(word);
      return SPECIAL_TAG_LABELS[wordSlug] ?? word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

export function tagReferenceId(tag: unknown): string | undefined {
  if (typeof tag === "string") return tag;
  if (tag === null || typeof tag !== "object") return undefined;

  const { id } = tag as { id?: unknown };
  return typeof id === "string" ? id : undefined;
}

export function addTagLabelCandidate(candidates: TagLabelCandidateMap, slug: string, label: string | undefined): void {
  if (!slug || !label?.trim()) return;

  const formatted = formatTagLabel(label);
  const existing = candidates.get(slug) ?? [];
  if (!existing.includes(formatted)) {
    existing.push(formatted);
  }
  candidates.set(slug, existing);
}

export function getTagLabelSources(
  tags: Array<{ id: string; data: { name: string; slug?: string }; isLocalized?: boolean }>,
): TagLabelSourceMap {
  const labels: TagLabelSourceMap = new Map();

  for (const tag of tags) {
    const slug = normalizeTagSlug(tag.data.slug || tag.id);
    if (!slug) continue;

    labels.set(slug, {
      label: tag.data.name,
      localized: tag.isLocalized === true,
    });
  }

  return labels;
}

export function getPublicationTagSlugs(
  publication: CollectionEntry<"publications">,
  sourceRelatedInterestsById: Map<string, string[]>,
  candidates?: TagLabelCandidateMap,
): string[] {
  const sourceTags = sourceRelatedInterestsById.get(publication.id) ?? publication.data.related_interests ?? [];
  return getInterestTagSlugs(sourceTags, publication.data.related_interests ?? [], candidates);
}

export function getInterestTagSlugs(sourceTags: string[], localizedTags: string[], candidates?: TagLabelCandidateMap): string[] {
  // PolyStella may localize `related_interests`; use source values for keys
  // and localized values only as label candidates.
  return sourceTags
    .map((sourceTag, index) => {
      const slug = normalizeTagSlug(sourceTag);
      if (candidates) addTagLabelCandidate(candidates, slug, localizedTags[index] ?? sourceTag);
      return slug;
    })
    .filter(Boolean);
}

export function getBlogTagSlugs(post: CollectionEntry<"blog">): string[] {
  return (post.data.tags ?? []).map((tag) => normalizeTagSlug(tagReferenceId(tag))).filter(Boolean);
}

export function resolveTagLabel(slug: string, labelSources: TagLabelSourceMap, candidates: TagLabelCandidateMap, locale: string): string {
  const source = labelSources.get(slug);
  if (source?.localized) return source.label;

  const candidate = locale === "en-US" ? undefined : candidates.get(slug)?.find((label) => normalizeTagSlug(label) !== slug);
  if (candidate) return candidate;

  return source?.label ?? SPECIAL_TAG_LABELS[slug] ?? formatTagLabel(slug);
}

export function buildTagLabelRecord(
  slugs: Iterable<string>,
  labelSources: TagLabelSourceMap,
  candidates: TagLabelCandidateMap,
  locale: string,
): Record<string, string> {
  return Object.fromEntries([...slugs].map((slug) => [slug, resolveTagLabel(slug, labelSources, candidates, locale)]));
}
