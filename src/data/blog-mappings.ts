export interface BlogMapping {
  author?: string;
  pillar?: "private" | "safe" | "fast" | "reliable" | "measurable";
  tags?: string[];
}

export const blogMappings: Record<string, BlogMapping> = {
  "http://blog.cloudflare.com/react2shell-rsc-vulnerabilities-exploitation-threat-brief":
    {
      pillar: "safe",
      tags: ["security", "vulnerabilities"],
    },
  "http://blog.cloudflare.com/fresh-insights-from-old-data-corroborating-reports-of-turkmenistan-ip":
    {
      pillar: "measurable",
      tags: ["censorship", "measurement"],
    },
  "http://blog.cloudflare.com/agent-registry": {
    pillar: "private",
    tags: ["privacy", "bots"],
  },
  "http://blog.cloudflare.com/private-rate-limiting": {
    pillar: "private",
    tags: ["privacy", "cryptography"],
  },
  "http://blog.cloudflare.com/measuring-network-connections-at-scale": {
    pillar: "measurable",
    tags: ["measurement", "TCP"],
  },
  "http://blog.cloudflare.com/detecting-cgn-to-reduce-collateral-damage": {
    pillar: "measurable",
    tags: ["measurement", "IPv4"],
  },
  "http://blog.cloudflare.com/how-to-build-your-own-vpn-or-the-history-of-warp":
    {
      pillar: "private",
      tags: ["VPN", "privacy"],
    },
  "http://blog.cloudflare.com/defending-quic-from-acknowledgement-based-ddos-attacks":
    {
      pillar: "safe",
      tags: ["security", "DDoS", "quic"],
    },
  "http://blog.cloudflare.com/so-long-and-thanks-for-all-the-fish-how-to-escape-the-linux-networking-stack":
    {
      pillar: "fast",
      tags: ["performance", "networking"],
    },
  "http://blog.cloudflare.com/pq-2025": {
    pillar: "private",
    tags: ["post-quantum", "cryptography"],
  },
  "http://blog.cloudflare.com/bootstrap-mtc": {
    pillar: "private",
    tags: ["cryptography", "privacy"],
  },
  "http://blog.cloudflare.com/a-framework-for-measuring-internet-resilience": {
    pillar: "measurable",
    tags: ["measurement", "resilience"],
  },
  "http://blog.cloudflare.com/tricky-internet-measurement": {
    pillar: "measurable",
    tags: ["measurement"],
  },
  "http://blog.cloudflare.com/introducing-tld-insights-on-cloudflare-radar": {
    pillar: "measurable",
    tags: ["measurement", "DNS"],
  },
  "http://blog.cloudflare.com/experience-of-data-at-scale": {
    pillar: "measurable",
    tags: ["data", "analytics"],
  },
  "http://blog.cloudflare.com/evolution-of-cloudflare-radar": {
    pillar: "measurable",
    tags: ["measurement", "analytics"],
  },
  "http://blog.cloudflare.com/internet-measurement-resilience-transparency-week":
    {
      pillar: "measurable",
      tags: ["measurement", "transparency"],
    },
  "http://blog.cloudflare.com/how-does-cloudflares-speed-test-really-work": {
    pillar: "fast",
    tags: ["performance", "measurement"],
  },
  "http://blog.cloudflare.com/improving-the-trustworthiness-of-javascript-on-the-web":
    {
      pillar: "safe",
      tags: ["security", "javascript"],
    },
  "http://blog.cloudflare.com/automatically-secure": {
    pillar: "safe",
    tags: ["security", "automation"],
  },
  "http://blog.cloudflare.com/you-dont-need-quantum-hardware": {
    pillar: "private",
    tags: ["post-quantum", "cryptography"],
  },
  "http://blog.cloudflare.com/verified-bots-with-cryptography": {
    pillar: "private",
    tags: ["cryptography", "bots"],
  },
  "http://blog.cloudflare.com/orange-me2eets-we-made-an-end-to-end-encrypted-video-calling-app-and-it-was":
    {
      pillar: "private",
      tags: ["encryption", "privacy"],
    },
  "http://blog.cloudflare.com/web-bot-auth": {
    pillar: "safe",
    tags: ["security", "bots"],
  },
  "http://blog.cloudflare.com/azul-certificate-transparency-log": {
    pillar: "safe",
    tags: ["security", "certificates"],
  },
  "http://blog.cloudflare.com/open-sourcing-openpubkey-ssh-opkssh-integrating-single-sign-on-with-ssh":
    {
      pillar: "safe",
      tags: ["security", "SSH"],
    },
  "http://blog.cloudflare.com/lattice-crypto-primer": {
    pillar: "private",
    tags: ["cryptography", "post-quantum"],
  },
  "http://blog.cloudflare.com/https-only-for-cloudflare-apis-shutting-the-door-on-cleartext-traffic":
    {
      pillar: "safe",
      tags: ["security", "encryption"],
    },
  "http://blog.cloudflare.com/an-early-look-at-cryptographic-watermarks-for-ai-generated-content":
    {
      pillar: "private",
      tags: ["cryptography", "AI"],
    },
  "http://blog.cloudflare.com/post-quantum-zero-trust": {
    pillar: "private",
    tags: ["post-quantum", "zero-trust"],
  },
  "http://blog.cloudflare.com/sometimes-i-cache": {
    pillar: "fast",
    tags: ["performance", "caching"],
  },
  "http://blog.cloudflare.com/topaz-policy-engine-design": {
    pillar: "safe",
    tags: ["security", "DNS"],
  },
  "http://blog.cloudflare.com/another-look-at-pq-signatures": {
    pillar: "private",
    tags: ["post-quantum", "cryptography"],
  },
  "http://blog.cloudflare.com/introducing-speed-brain": {
    pillar: "fast",
    tags: ["performance", "optimization"],
  },
  "http://blog.cloudflare.com/key-transparency": {
    pillar: "private",
    tags: ["cryptography", "transparency"],
  },
  "http://blog.cloudflare.com/connection-tampering": {
    pillar: "measurable",
    tags: ["measurement", "security"],
  },
  "http://blog.cloudflare.com/tcp-resets-timeouts": {
    pillar: "measurable",
    tags: ["measurement", "TCP"],
  },
  "http://blog.cloudflare.com/nists-first-post-quantum-standards": {
    pillar: "private",
    tags: ["post-quantum", "standards"],
  },
  "http://blog.cloudflare.com/introducing-automatic-ssl-tls-securing-and-simplifying-origin-connectivity":
    {
      pillar: "safe",
      tags: ["security", "SSL"],
    },
  "http://blog.cloudflare.com/harnessing-office-chaos": {
    pillar: "private",
    tags: ["cryptography", "randomness"],
  },
  "http://blog.cloudflare.com/pq-2024": {
    pillar: "private",
    tags: ["post-quantum", "cryptography"],
  },
  "http://blog.cloudflare.com/privacy-pass-standard": {
    pillar: "private",
    tags: ["privacy", "standards"],
  },
  "http://blog.cloudflare.com/have-your-data-and-hide-it-too-an-introduction-to-differential-privacy":
    {
      pillar: "private",
      tags: ["privacy", "differential-privacy"],
    },
  "http://blog.cloudflare.com/birthday-week-2023-wrap-up": {
    pillar: "measurable",
    tags: ["announcements"],
  },
  "http://blog.cloudflare.com/post-quantum-cryptography-ga": {
    pillar: "private",
    tags: ["post-quantum", "cryptography"],
  },
  "http://blog.cloudflare.com/announcing-encrypted-client-hello": {
    pillar: "private",
    tags: ["privacy", "encryption"],
  },
  "http://blog.cloudflare.com/post-quantum-to-origins": {
    pillar: "private",
    tags: ["post-quantum", "cryptography"],
  },
  "http://blog.cloudflare.com/deep-dive-privacy-preserving-measurement": {
    pillar: "private",
    tags: ["privacy", "measurement"],
  },
  "http://blog.cloudflare.com/connection-coalescing-with-origin-frames-fewer-dns-queries-fewer-connections":
    {
      pillar: "fast",
      tags: ["performance", "optimization"],
    },
  "http://blog.cloudflare.com/post-quantum-crypto-should-be-free": {
    pillar: "private",
    tags: ["post-quantum", "cryptography"],
  },
  "http://blog.cloudflare.com/kyber-isnt-broken": {
    pillar: "private",
    tags: ["post-quantum", "cryptography"],
  },
  "http://blog.cloudflare.com/inside-geo-key-manager-v2": {
    pillar: "safe",
    tags: ["security", "key-management"],
  },
  "http://blog.cloudflare.com/stronger-than-a-promise-proving-oblivious-http-privacy-properties":
    {
      pillar: "private",
      tags: ["privacy", "cryptography"],
    },
  "http://blog.cloudflare.com/post-quantum-for-all": {
    pillar: "private",
    tags: ["post-quantum", "cryptography"],
  },
  "http://blog.cloudflare.com/securing-origin-connectivity": {
    pillar: "safe",
    tags: ["security", "SSL"],
  },
  "http://blog.cloudflare.com/post-quantum-tunnel": {
    pillar: "private",
    tags: ["post-quantum", "cryptography"],
  },
  "http://blog.cloudflare.com/deep-dives-how-the-internet-works": {
    pillar: "measurable",
    tags: ["education"],
  },
  "http://blog.cloudflare.com/experiment-with-pq": {
    pillar: "private",
    tags: ["post-quantum", "cryptography"],
  },
  "http://blog.cloudflare.com/nist-post-quantum-surprise": {
    pillar: "private",
    tags: ["post-quantum", "standards"],
  },
  "http://blog.cloudflare.com/hertzbleed-explained": {
    pillar: "safe",
    tags: ["security", "vulnerabilities"],
  },
  "http://blog.cloudflare.com/next-gen-web3-network": {
    pillar: "reliable",
    tags: ["web3", "infrastructure"],
  },
  "http://blog.cloudflare.com/cloudflare-pages-on-ipfs": {
    pillar: "reliable",
    tags: ["web3", "IPFS"],
  },
  "http://blog.cloudflare.com/ipfs-measurements": {
    pillar: "measurable",
    tags: ["measurement", "web3"],
  },
  "http://blog.cloudflare.com/breaking-down-broadband-nutrition-labels": {
    pillar: "measurable",
    tags: ["measurement", "transparency"],
  },
  "http://blog.cloudflare.com/future-proofing-saltstack": {
    pillar: "safe",
    tags: ["security", "infrastructure"],
  },
  "http://blog.cloudflare.com/unlocking-quic-proxying-potential": {
    pillar: "fast",
    tags: ["performance", "quic"],
  },
  "http://blog.cloudflare.com/a-primer-on-proxies": {
    pillar: "fast",
    tags: ["performance", "proxies"],
  },
  "http://blog.cloudflare.com/announcing-ddr-support": {
    pillar: "private",
    tags: ["privacy", "DNS"],
  },
  "http://blog.cloudflare.com/post-quantum-future": {
    pillar: "private",
    tags: ["post-quantum", "cryptography"],
  },
  "http://blog.cloudflare.com/post-quantumify-cloudflare": {
    pillar: "private",
    tags: ["post-quantum", "cryptography"],
  },
  "http://blog.cloudflare.com/hybrid-public-key-encryption": {
    pillar: "private",
    tags: ["cryptography", "encryption"],
  },
  "http://blog.cloudflare.com/post-quantum-formal-analysis": {
    pillar: "private",
    tags: ["post-quantum", "cryptography"],
  },
  "http://blog.cloudflare.com/post-quantum-easycrypt-jasmin": {
    pillar: "private",
    tags: ["post-quantum", "cryptography"],
  },
  "http://blog.cloudflare.com/making-protocols-post-quantum": {
    pillar: "private",
    tags: ["post-quantum", "protocols"],
  },
  "http://blog.cloudflare.com/post-quantum-key-encapsulation": {
    pillar: "private",
    tags: ["post-quantum", "cryptography"],
  },
  "http://blog.cloudflare.com/post-quantum-signatures": {
    pillar: "private",
    tags: ["post-quantum", "cryptography"],
  },
  "http://blog.cloudflare.com/post-quantum-taxonomy": {
    pillar: "private",
    tags: ["post-quantum", "cryptography"],
  },
  "http://blog.cloudflare.com/quantum-solace-and-spectre": {
    pillar: "private",
    tags: ["post-quantum", "cryptography"],
  },
  "http://blog.cloudflare.com/sizing-up-post-quantum-signatures": {
    pillar: "private",
    tags: ["post-quantum", "cryptography"],
  },
  "http://blog.cloudflare.com/observe-and-manage-cloudflare-tunnel": {
    pillar: "reliable",
    tags: ["infrastructure", "tunnel"],
  },
  "http://blog.cloudflare.com/cdn-latency-passive-measurement": {
    pillar: "measurable",
    tags: ["measurement", "performance"],
  },
  "http://blog.cloudflare.com/multi-user-ip-address-detection": {
    pillar: "measurable",
    tags: ["measurement", "detection"],
  },
  "http://blog.cloudflare.com/scaling-geo-key-manager": {
    pillar: "reliable",
    tags: ["infrastructure", "key-management"],
  },
  "http://blog.cloudflare.com/privacy-preserving-compromised-credential-checking":
    {
      pillar: "private",
      tags: ["privacy", "security"],
    },
  "http://blog.cloudflare.com/addressing-agility": {
    pillar: "reliable",
    tags: ["networking", "infrastructure"],
  },
  "http://blog.cloudflare.com/research-directions-in-password-security": {
    pillar: "safe",
    tags: ["security", "passwords"],
  },
  "http://blog.cloudflare.com/cloudflare-and-the-ietf": {
    pillar: "measurable",
    tags: ["standards", "collaboration"],
  },
  "http://blog.cloudflare.com/circl-pairings-update": {
    pillar: "private",
    tags: ["cryptography"],
  },
  "http://blog.cloudflare.com/exported-authenticators-the-long-road-to-rfc": {
    pillar: "safe",
    tags: ["security", "standards"],
  },
  "http://blog.cloudflare.com/connection-coalescing-experiments": {
    pillar: "fast",
    tags: ["performance", "optimization"],
  },
  "http://blog.cloudflare.com/ssl-tls-recommender": {
    pillar: "safe",
    tags: ["security", "SSL"],
  },
  "http://blog.cloudflare.com/spectre-research-with-tu-graz": {
    pillar: "safe",
    tags: ["security", "research"],
  },
  "http://blog.cloudflare.com/handshake-encryption-endgame-an-ech-update": {
    pillar: "private",
    tags: ["privacy", "encryption"],
  },
  "http://blog.cloudflare.com/privacy-pass-v3": {
    pillar: "private",
    tags: ["privacy"],
  },
  "http://blog.cloudflare.com/announcing-cloudflare-research-hub": {
    pillar: "measurable",
    tags: ["research"],
  },
  "http://blog.cloudflare.com/internship-experience-research-engineer": {
    pillar: "measurable",
    tags: ["research"],
  },
  "http://blog.cloudflare.com/visiting-researcher-program": {
    pillar: "measurable",
    tags: ["research"],
  },
  "http://blog.cloudflare.com/cloudflare-research-two-years-in": {
    pillar: "measurable",
    tags: ["research"],
  },
  "http://blog.cloudflare.com/announcing-web3-gateways": {
    pillar: "reliable",
    tags: ["web3", "infrastructure"],
  },
  "http://blog.cloudflare.com/what-is-web3": {
    pillar: "reliable",
    tags: ["web3"],
  },
};
