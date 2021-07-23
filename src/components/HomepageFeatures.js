import React from 'react';
import clsx from 'clsx';
import styles from './HomepageFeatures.module.css';

const FeatureList = [
  {
    title: 'Ending CAPTCHAs with the Cryptographic Attestation of Personhood',
    image: 'https://blog.cloudflare.com/content/images/2021/04/image2-36.png',
    url: 'https://blog.cloudflare.com/introducing-cryptographic-attestation-of-personhood/',
    description: (
      <>
         A real human should be able to touch or look at their device to prove they are human, without revealing their identity. 
      </>
    ),
  },
  {
    title: 'Improving DNS Privacy with Oblivious DoH in 1.1.1.1',
    image: 'https://blog.cloudflare.com/content/images/2020/12/image2-4.png',
    url: 'https://blog.cloudflare.com/oblivious-dns/',
    description: (
      <>
       We support a new proposed DNS standard — co-authored by engineers from Cloudflare, Apple, and Fastly — 
       that separates IP addresses from queries, so that no single entity can see both at the same time
      </>
    ),
  },
  {
    title: 'A Name Resolver for the Distributed Web',
    image: 'https://blog.cloudflare.com/content/images/2021/01/image4-2.png',
    url: 'https://blog.cloudflare.com/cloudflare-distributed-web-resolver/',
    description: (
      <>
        Announcing a new resolver for the Distributed Web, where IPFS content indexed by the Ethereum Name Service (ENS) can be accessed.
      </>
    ),
  },
];

function Feature({title, image, url, description}) {
  return (
    <div className={clsx('col col--4')}>
      <div className="text--center">
        <img src={image} />
      </div>
      <a href={url} target="_blank">
      <div className="text--center padding-horiz--md">
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      </a>
    </div>
  );
}

export default function HomepageFeatures() {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
