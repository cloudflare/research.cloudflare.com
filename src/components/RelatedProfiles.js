import React from 'react';
import clsx from 'clsx';
import styles from './RelatedProfiles.module.css';
import useGlobalData from '@docusaurus/useGlobalData';

import ProfileBubble from '@site/src/components/ProfileBubble';


export default function RelatedProfiles( { slugs } ) {
  
  const globalData = useGlobalData();
  
  const slugArray = String(slugs).split( ',' );
  let profilesArray = [];
  
  // assemble array of profiles we want to link to
  for ( const slug of slugArray ) {
    let profile = globalData[ 'people' ][ 'default' ][ slug ];
    
    if ( typeof( profile ) !== 'undefined' ) 
      profilesArray.push( profile );
  }

  return (
    <div>
    {profilesArray.map(( profile, index ) => {
      return <ProfileBubble profile={profile} key={index} />
    }
    
    )}
    </div>
  );
}
