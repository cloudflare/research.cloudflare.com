export interface BlogMapping {
  author?: string;
  pillar?: "private" | "safe" | "fast" | "reliable" | "measurable";
  tags?: string[];
}

export const blogMappings: Record<string, BlogMapping> = {
  "http://blog.cloudflare.com/past-bots-and-humans": {
    author: "thibault-meunier",
  },
  "http://blog.cloudflare.com/unweight-tensor-compression": {
    author: "mari-galicer",
  },
  "http://blog.cloudflare.com/rethinking-cache-ai-humans": {
    author: "suleman-ahmad",
  },
  "http://blog.cloudflare.com/radar-origin-pq-key-transparency-aspa": {
    author: "thibault-meunier",
  },
  "http://blog.cloudflare.com/react2shell-rsc-vulnerabilities-exploitation-threat-brief":
    {
      pillar: "safe",
      tags: ["security", "vulnerabilities"],
    },
  "http://blog.cloudflare.com/fresh-insights-from-old-data-corroborating-reports-of-turkmenistan-ip":
    {
      author: "luke-valenta",
      pillar: "measurable",
      tags: ["censorship", "measurement"],
    },
  "http://blog.cloudflare.com/agent-registry": {
    author: "thibault-meunier",
    pillar: "private",
    tags: ["privacy", "bots"],
  },
  "http://blog.cloudflare.com/private-rate-limiting": {
    author: "thibault-meunier",
    pillar: "private",
    tags: ["privacy", "cryptography"],
  },
  "http://blog.cloudflare.com/measuring-network-connections-at-scale": {
    author: "suleman-ahmad",
    pillar: "measurable",
    tags: ["measurement", "TCP"],
  },
  "http://blog.cloudflare.com/detecting-cgn-to-reduce-collateral-damage": {
    author: "vasilis-giotsas",
    pillar: "measurable",
    tags: ["measurement", "IPv4"],
  },
  "http://blog.cloudflare.com/how-to-build-your-own-vpn-or-the-history-of-warp":
    {
      author: "chris-branch",
      pillar: "private",
      tags: ["VPN", "privacy"],
    },
  "http://blog.cloudflare.com/defending-quic-from-acknowledgement-based-ddos-attacks":
    {
      author: "apoorv-kothari",
      pillar: "safe",
      tags: ["security", "DDoS", "quic"],
    },
  "http://blog.cloudflare.com/so-long-and-thanks-for-all-the-fish-how-to-escape-the-linux-networking-stack":
    {
      author: "thibault-meunier",
      pillar: "fast",
      tags: ["performance", "networking"],
    },
  "http://blog.cloudflare.com/pq-2025": {
    author: "bas-westerbaan",
    pillar: "private",
    tags: ["post-quantum", "cryptography"],
  },
  "http://blog.cloudflare.com/bootstrap-mtc": {
    author: "luke-valenta",
    pillar: "private",
    tags: ["cryptography", "privacy"],
  },
  "http://blog.cloudflare.com/a-framework-for-measuring-internet-resilience": {
    author: "vasilis-giotsas",
    pillar: "measurable",
    tags: ["measurement", "resilience"],
  },
  "http://blog.cloudflare.com/tricky-internet-measurement": {
    author: "marwan-fayed",
    pillar: "measurable",
    tags: ["measurement"],
  },
  "http://blog.cloudflare.com/introducing-tld-insights-on-cloudflare-radar": {
    author: "david-belson",
    pillar: "measurable",
    tags: ["measurement", "DNS"],
  },
  "http://blog.cloudflare.com/experience-of-data-at-scale": {
    author: "marwan-fayed",
    pillar: "measurable",
    tags: ["data", "analytics"],
  },
  "http://blog.cloudflare.com/evolution-of-cloudflare-radar": {
    author: "david-belson",
    pillar: "measurable",
    tags: ["measurement", "analytics"],
  },
  "http://blog.cloudflare.com/internet-measurement-resilience-transparency-week":
    {
      author: "mari-galicer",
      pillar: "measurable",
      tags: ["measurement", "transparency"],
    },
  "http://blog.cloudflare.com/how-does-cloudflares-speed-test-really-work": {
    author: "lai-yi-ohlsen",
    pillar: "fast",
    tags: ["performance", "measurement"],
  },
  "http://blog.cloudflare.com/improving-the-trustworthiness-of-javascript-on-the-web":
    {
      author: "michael-rosenberg",
      pillar: "safe",
      tags: ["security", "javascript"],
    },
  "http://blog.cloudflare.com/automatically-secure": {
    author: "suleman-ahmad",
    pillar: "safe",
    tags: ["security", "automation"],
  },
  "http://blog.cloudflare.com/you-dont-need-quantum-hardware": {
    author: "luke-valenta",
    pillar: "private",
    tags: ["post-quantum", "cryptography"],
  },
  "http://blog.cloudflare.com/verified-bots-with-cryptography": {
    author: "mari-galicer",
    pillar: "private",
    tags: ["cryptography", "bots"],
  },
  "http://blog.cloudflare.com/orange-me2eets-we-made-an-end-to-end-encrypted-video-calling-app-and-it-was":
    {
      author: "mari-galicer",
      pillar: "private",
      tags: ["encryption", "privacy"],
    },
  "http://blog.cloudflare.com/web-bot-auth": {
    author: "thibault-meunier",
    pillar: "safe",
    tags: ["security", "bots"],
  },
  "http://blog.cloudflare.com/azul-certificate-transparency-log": {
    author: "luke-valenta",
    pillar: "safe",
    tags: ["security", "certificates"],
  },
  "http://blog.cloudflare.com/open-sourcing-openpubkey-ssh-opkssh-integrating-single-sign-on-with-ssh":
    {
      author: "ethan-heilman",
      pillar: "safe",
      tags: ["security", "SSH"],
    },
  "http://blog.cloudflare.com/lattice-crypto-primer": {
    author: "christopher-patton",
    pillar: "private",
    tags: ["cryptography", "post-quantum"],
  },
  "http://blog.cloudflare.com/https-only-for-cloudflare-apis-shutting-the-door-on-cleartext-traffic":
    {
      author: "suleman-ahmad",
      pillar: "safe",
      tags: ["security", "encryption"],
    },
  "http://blog.cloudflare.com/an-early-look-at-cryptographic-watermarks-for-ai-generated-content":
    {
      author: "christopher-patton",
      pillar: "private",
      tags: ["cryptography", "AI"],
    },
  "http://blog.cloudflare.com/post-quantum-zero-trust": {
    author: "wesley-evans",
    pillar: "private",
    tags: ["post-quantum", "zero-trust"],
  },
  "http://blog.cloudflare.com/sometimes-i-cache": {
    author: "thibault-meunier",
    pillar: "fast",
    tags: ["performance", "caching"],
  },
  "http://blog.cloudflare.com/topaz-policy-engine-design": {
    author: "suleman-ahmad",
    pillar: "safe",
    tags: ["security", "DNS"],
  },
  "http://blog.cloudflare.com/another-look-at-pq-signatures": {
    author: "bas-westerbaan",
    pillar: "private",
    tags: ["post-quantum", "cryptography"],
  },
  "http://blog.cloudflare.com/introducing-speed-brain": {
    author: "suleman-ahmad",
    pillar: "fast",
    tags: ["performance", "optimization"],
  },
  "http://blog.cloudflare.com/key-transparency": {
    author: "thibault-meunier",
    pillar: "private",
    tags: ["cryptography", "transparency"],
  },
  "http://blog.cloudflare.com/connection-tampering": {
    author: "luke-valenta",
    pillar: "measurable",
    tags: ["measurement", "security"],
  },
  "http://blog.cloudflare.com/tcp-resets-timeouts": {
    author: "luke-valenta",
    pillar: "measurable",
    tags: ["measurement", "TCP"],
  },
  "http://blog.cloudflare.com/nists-first-post-quantum-standards": {
    author: "bas-westerbaan",
    pillar: "private",
    tags: ["post-quantum", "standards"],
  },
  "http://blog.cloudflare.com/introducing-automatic-ssl-tls-securing-and-simplifying-origin-connectivity":
    {
      author: "suleman-ahmad",
      pillar: "safe",
      tags: ["security", "SSL"],
    },
  "http://blog.cloudflare.com/harnessing-office-chaos": {
    author: "thibault-meunier",
    pillar: "private",
    tags: ["cryptography", "randomness"],
  },
  "http://blog.cloudflare.com/pq-2024": {
    author: "bas-westerbaan",
    pillar: "private",
    tags: ["post-quantum", "cryptography"],
  },
  "http://blog.cloudflare.com/privacy-pass-standard": {
    author: "thibault-meunier",
    pillar: "private",
    tags: ["privacy", "standards"],
  },
  "http://blog.cloudflare.com/have-your-data-and-hide-it-too-an-introduction-to-differential-privacy":
    {
      author: "avani-wildani",
      pillar: "private",
      tags: ["privacy", "differential-privacy"],
    },
  "http://blog.cloudflare.com/birthday-week-2023-wrap-up": {
    author: "dina-kozlov",
    pillar: "measurable",
    tags: ["announcements"],
  },
  "http://blog.cloudflare.com/post-quantum-cryptography-ga": {
    author: "wesley-evans",
    pillar: "private",
    tags: ["post-quantum", "cryptography"],
  },
  "http://blog.cloudflare.com/announcing-encrypted-client-hello": {
    author: "christopher-wood",
    pillar: "private",
    tags: ["privacy", "encryption"],
  },
  "http://blog.cloudflare.com/post-quantum-to-origins": {
    author: "suleman-ahmad",
    pillar: "private",
    tags: ["post-quantum", "cryptography"],
  },
  "http://blog.cloudflare.com/deep-dive-privacy-preserving-measurement": {
    author: "mari-galicer",
    pillar: "private",
    tags: ["privacy", "measurement"],
  },
  "http://blog.cloudflare.com/connection-coalescing-with-origin-frames-fewer-dns-queries-fewer-connections":
    {
      author: "suleman-ahmad",
      pillar: "fast",
      tags: ["performance", "optimization"],
    },
  "http://blog.cloudflare.com/post-quantum-crypto-should-be-free": {
    author: "bas-westerbaan",
    pillar: "private",
    tags: ["post-quantum", "cryptography"],
  },
  "http://blog.cloudflare.com/kyber-isnt-broken": {
    author: "bas-westerbaan",
    pillar: "private",
    tags: ["post-quantum", "cryptography"],
  },
  "http://blog.cloudflare.com/inside-geo-key-manager-v2": {
    author: "tanya-verma",
    pillar: "safe",
    tags: ["security", "key-management"],
  },
  "http://blog.cloudflare.com/stronger-than-a-promise-proving-oblivious-http-privacy-properties":
    {
      author: "christopher-wood",
      pillar: "private",
      tags: ["privacy", "cryptography"],
    },
  "http://blog.cloudflare.com/post-quantum-for-all": {
    author: "bas-westerbaan",
    pillar: "private",
    tags: ["post-quantum", "cryptography"],
  },
  "http://blog.cloudflare.com/securing-origin-connectivity": {
    author: "suleman-ahmad",
    pillar: "safe",
    tags: ["security", "SSL"],
  },
  "http://blog.cloudflare.com/post-quantum-tunnel": {
    author: "bas-westerbaan",
    pillar: "private",
    tags: ["post-quantum", "cryptography"],
  },
  "http://blog.cloudflare.com/deep-dives-how-the-internet-works": {
    author: "nick-sullivan",
    pillar: "measurable",
    tags: ["education"],
  },
  "http://blog.cloudflare.com/experiment-with-pq": {
    author: "bas-westerbaan",
    pillar: "private",
    tags: ["post-quantum", "cryptography"],
  },
  "http://blog.cloudflare.com/nist-post-quantum-surprise": {
    author: "bas-westerbaan",
    pillar: "private",
    tags: ["post-quantum", "standards"],
  },
  "http://blog.cloudflare.com/hertzbleed-explained": {
    author: "armando-faz",
    pillar: "safe",
    tags: ["security", "vulnerabilities"],
  },
  "http://blog.cloudflare.com/next-gen-web3-network": {
    author: "wesley-evans",
    pillar: "reliable",
    tags: ["web3", "infrastructure"],
  },
  "http://blog.cloudflare.com/cloudflare-pages-on-ipfs": {
    author: "thibault-meunier",
    pillar: "reliable",
    tags: ["web3", "IPFS"],
  },
  "http://blog.cloudflare.com/ipfs-measurements": {
    author: "thibault-meunier",
    pillar: "measurable",
    tags: ["measurement", "web3"],
  },
  "http://blog.cloudflare.com/breaking-down-broadband-nutrition-labels": {
    author: "kristin-berdan",
    pillar: "measurable",
    tags: ["measurement", "transparency"],
  },
  "http://blog.cloudflare.com/future-proofing-saltstack": {
    author: "lenka-marekova",
    pillar: "safe",
    tags: ["security", "infrastructure"],
  },
  "http://blog.cloudflare.com/unlocking-quic-proxying-potential": {
    author: "christopher-wood",
    pillar: "fast",
    tags: ["performance", "quic"],
  },
  "http://blog.cloudflare.com/a-primer-on-proxies": {
    author: "christopher-wood",
    pillar: "fast",
    tags: ["performance", "proxies"],
  },
  "http://blog.cloudflare.com/announcing-ddr-support": {
    author: "christopher-wood",
    pillar: "private",
    tags: ["privacy", "DNS"],
  },
  "http://blog.cloudflare.com/post-quantum-future": {
    author: "nick-sullivan",
    pillar: "private",
    tags: ["post-quantum", "cryptography"],
  },
  "http://blog.cloudflare.com/post-quantumify-cloudflare": {
    author: "thom-wiggers",
    pillar: "private",
    tags: ["post-quantum", "cryptography"],
  },
  "http://blog.cloudflare.com/hybrid-public-key-encryption": {
    author: "christopher-wood",
    pillar: "private",
    tags: ["cryptography", "encryption"],
  },
  "http://blog.cloudflare.com/post-quantum-formal-analysis": {
    author: "jonathan-hoyland",
    pillar: "private",
    tags: ["post-quantum", "cryptography"],
  },
  "http://blog.cloudflare.com/post-quantum-easycrypt-jasmin": {
    author: "manuel-barbosa",
    pillar: "private",
    tags: ["post-quantum", "cryptography"],
  },
  "http://blog.cloudflare.com/making-protocols-post-quantum": {
    author: "thom-wiggers",
    pillar: "private",
    tags: ["post-quantum", "protocols"],
  },
  "http://blog.cloudflare.com/post-quantum-key-encapsulation": {
    author: "goutam-tamvada",
    pillar: "private",
    tags: ["post-quantum", "cryptography"],
  },
  "http://blog.cloudflare.com/post-quantum-signatures": {
    author: "goutam-tamvada",
    pillar: "private",
    tags: ["post-quantum", "cryptography"],
  },
  "http://blog.cloudflare.com/post-quantum-taxonomy": {
    author: "sofia-celi",
    pillar: "private",
    tags: ["post-quantum", "cryptography"],
  },
  "http://blog.cloudflare.com/quantum-solace-and-spectre": {
    author: "sofia-celi",
    pillar: "private",
    tags: ["post-quantum", "cryptography"],
  },
  "http://blog.cloudflare.com/sizing-up-post-quantum-signatures": {
    author: "bas-westerbaan",
    pillar: "private",
    tags: ["post-quantum", "cryptography"],
  },
  "http://blog.cloudflare.com/observe-and-manage-cloudflare-tunnel": {
    author: "abe-carryl",
    pillar: "reliable",
    tags: ["infrastructure", "tunnel"],
  },
  "http://blog.cloudflare.com/cdn-latency-passive-measurement": {
    author: "vasilis-giotsas",
    pillar: "measurable",
    tags: ["measurement", "performance"],
  },
  "http://blog.cloudflare.com/multi-user-ip-address-detection": {
    author: "alex-chen",
    pillar: "measurable",
    tags: ["measurement", "detection"],
  },
  "http://blog.cloudflare.com/scaling-geo-key-manager": {
    author: "tanya-verma",
    pillar: "reliable",
    tags: ["infrastructure", "key-management"],
  },
  "http://blog.cloudflare.com/privacy-preserving-compromised-credential-checking":
    {
      author: "luke-valenta",
      pillar: "private",
      tags: ["privacy", "security"],
    },
  "http://blog.cloudflare.com/addressing-agility": {
    author: "marwan-fayed",
    pillar: "reliable",
    tags: ["networking", "infrastructure"],
  },
  "http://blog.cloudflare.com/research-directions-in-password-security": {
    author: "tara-whalen",
    pillar: "safe",
    tags: ["security", "passwords"],
  },
  "http://blog.cloudflare.com/cloudflare-and-the-ietf": {
    author: "jonathan-hoyland",
    pillar: "measurable",
    tags: ["standards", "collaboration"],
  },
  "http://blog.cloudflare.com/circl-pairings-update": {
    author: "watson-ladd",
    pillar: "private",
    tags: ["cryptography"],
  },
  "http://blog.cloudflare.com/exported-authenticators-the-long-road-to-rfc": {
    author: "jonathan-hoyland",
    pillar: "safe",
    tags: ["security", "standards"],
  },
  "http://blog.cloudflare.com/connection-coalescing-experiments": {
    author: "suleman-ahmad",
    pillar: "fast",
    tags: ["performance", "optimization"],
  },
  "http://blog.cloudflare.com/ssl-tls-recommender": {
    author: "suleman-ahmad",
    pillar: "safe",
    tags: ["security", "SSL"],
  },
  "http://blog.cloudflare.com/spectre-research-with-tu-graz": {
    author: "kenton-varda",
    pillar: "safe",
    tags: ["security", "research"],
  },
  "http://blog.cloudflare.com/handshake-encryption-endgame-an-ech-update": {
    author: "christopher-wood",
    pillar: "private",
    tags: ["privacy", "encryption"],
  },
  "http://blog.cloudflare.com/privacy-pass-v3": {
    author: "armando-faz",
    pillar: "private",
    tags: ["privacy"],
  },
  "http://blog.cloudflare.com/announcing-cloudflare-research-hub": {
    author: "thibault-meunier",
    pillar: "measurable",
    tags: ["research"],
  },
  "http://blog.cloudflare.com/internship-experience-research-engineer": {
    author: "thibault-meunier",
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
  "http://blog.cloudflare.com/the-quantum-menace": {
    pillar: "safe",
    tags: ["research", "cryptography", "post-quantum"],
  },
  "http://blog.cloudflare.com/introducing-circl": {
    pillar: "safe",
    tags: ["research", "cryptography", "post-quantum"],
  },
};
