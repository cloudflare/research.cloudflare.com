import React from 'react';
import clsx from 'clsx';
import styles from './ProfileHeader.module.css';
import useGlobalData from '@docusaurus/useGlobalData';



export default function ProfileHeader( props ) {  
  
  const slug = props.slug;
  let profile = props.profile;
  
  if ( typeof slug != 'undefined' ) {
    const globalData = useGlobalData();
    profile = globalData[ 'people'][ 'default' ][ slug ];
  }
  
  return (
    <div className={clsx( "avatar profile", styles.profile) } >
      <img className="avatar__photo avatar__photo--xl" src={profile.image} />
      <div className="avatar__intro">
        <div className="avatar__name">{profile.title}</div>
        <small className="avatar__subtitle">
          {profile.position}
        </small>
        {typeof profile.twitter !== 'undefined' &&
        <a className={clsx( styles.twitter )} href={"https://twitter.com/" + profile.twitter}>
          <img src="https://blog.cloudflare.com/assets/images/twitter.svg?v=af74676765" />
        </a>
        }
      </div>
    </div>
  );
}
