---
title: Distributed Web
related_profiles:
  - luke-valenta
  - jonathan-hoyland
  - peter-wu
  - thibault-meunier
  - wesley-evans
  - brendan-mcmillion
related_areas:
  - distributed_systems
resources:
  - text: "Announcing The Cloudflare Distributed Web Gateways Private Beta: Unlocking the Web3 Metaverse and Decentralized Finance for Everyone"
    blog: https://blog.cloudflare.com/announcing-web3-gateways/
  - text: Web3 — A vision for a decentralized web
    blog: https://blog.cloudflare.com/what-is-web3/
  - text: How Cloudflare provides tools to help keep IPFS users safe
    blog: https://blog.cloudflare.com/cloudflare-ipfs-safe-mode/
  - text: A Name Resolver for the Distributed Web
    blog: https://blog.cloudflare.com/cloudflare-distributed-web-resolver/
  - text: "Cloudflare goes InterPlanetary - Introducing Cloudflare’s IPFS Gateway"
    blog: https://blog.cloudflare.com/distributed-web-gateway/
  - text: Cloudflare's Ethereum Gateway
    blog: https://blog.cloudflare.com/cloudflare-ethereum-gateway/
  - text: Continuing to Improve our IPFS Gateway
    blog: https://blog.cloudflare.com/continuing-to-improve-our-ipfs-gateway/
  - text: Cloudflare Distributed Web Gateway
    link: https://cloudflare-ipfs.com
  - text: League of Entropy
    link: https://www.cloudflare.com/en-gb/leagueofentropy/
  - text: GitHub Repository of Cloudflare's IPFS implementation in Go
    link: https://github.com/cloudflare/go-ipfs
  - text: "Building on Decentralised Web at Cloudflare, IFIP 2021"
    youtube: https://www.youtube.com/embed/CjyQWVEnRUY
---

Description here.

Cloudflare operates distributed web gateways. These gateways provide an HTTP interface to Web3 protocols: Ethereum and IPFS. Since HTTP is core to the web we know today, distributed content can be accessed securely and easily without requiring the user to operate experimental software.

n to blockchain (Ethereum in our example) and the InterPlanetary FileSystem (IPFS). In a Web3 setting, you can think of Ethereum as the compute layer, and IPFS as the storage layer. By leveraging decentralised ledger technology, Ethereum provides verifiable decentralised computation. Publicly available binaries, called "smart contracts", can be instantiated by users to perform operations on an immutable set of records. This set of records is the state of the blockchain. It has to be maintained by every node on the network, so they can verify, and participate in the computation. Performing operations on a lot of data is therefore expensive. A common pattern is to use IPFS as an external storage solution. IPFS is a peer-to-peer network for storing content on a distributed file system. Content is identified by its hash, making it inexpensive to reference from a blockchain context.

Cloudflare Ethereum gateway relies on Ethereum nodes and provides a secure and fast interface to the Ethereum network. It allows application developers to leverage Ethereum in front-facing applications. The gateway can interact with any content part of the Ethereum chain.

The InterPlanetary FileSystem (IPFS) is a peer-to-peer network for storing content on a distributed file system. It is composed of a set of computers called nodes that store and relay content using a common addressing system


At Cloudflare, we believe that decentralization is going to be the next major step for content networks, but there is still work to be done to get these technologies in the hands of everyone

 there needs to be ways to prevent nodes from serving harmful content. Users need to be able to give consent on the content they are willing to serve, and the one they aren’t.