import React from 'react';
import clsx from 'clsx';
import Layout from '@theme/Layout';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import useGlobalData from '@docusaurus/useGlobalData';
import styles from './index.module.css';
import HomepageFeatures from '../../components/HomepageFeatures';
import ProfileBubble from '/src/components/ProfileBubble';

function PeopleHeader() {
  const {siteConfig} = useDocusaurusContext();
  const globalData = useGlobalData();
  const profiles = globalData['people']['default']['profiles'];
  
  const currentProfiles = profiles.filter( (item) => item.status == 'current' );
  const otherProfiles = profiles.filter( (item) => item.status != 'current' );
  
  return (
    <header className={clsx('hero hero--primary', styles.heroBanner)}>
      <div className="container">
        
        <div style={{whiteSpace: 'wrap', overflowX: 'auto'}}>
        {currentProfiles.map(( profile, index ) => {
          return <ProfileBubble key={index} profile={profile} color="white" />
        } ) }
        </div>
        
        <hr style={{ border: '2px solid #f98726', marginTop: '-10px' }} />
        
        <div style={{whiteSpace: 'wrap', overflowX: 'auto'}}>
        {otherProfiles.map(( profile, index ) => {
          return <ProfileBubble key={index} profile={profile} color="white" />
        } ) }
        </div>
        
        <div className={styles.buttons}>
          <Link
            className="button button--secondary button--lg"
            to="https://www.cloudflare.com/careers/jobs/?department=Technology%20Research&location=default">
            Join our team
          </Link>
          &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
          <Link
            className="button button--secondary button--lg"
            to="https://www.cloudflare.com/careers/jobs/?department=University&location=default">
            Internships available
          </Link>
        </div>
      </div>
    </header>
  );
}

export default function People() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <Layout
      title={'People'}
      description="Cloudflare Research - Research to help build a better Internet">
      <PeopleHeader />
      <main>
      </main>
    </Layout>
  );
}
