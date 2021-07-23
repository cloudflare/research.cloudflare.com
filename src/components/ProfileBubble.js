import React from 'react';
import clsx from 'clsx';
import styles from './ProfileBubble.module.css';

import useGlobalData from '@docusaurus/useGlobalData';


export default function ProfileBubble( props ) {  
  
  let color = props.color;
  if ( color === undefined )
    color = "black";
  
  const slug = props.slug;
  let profile = props.profile;
  
  if ( typeof slug != 'undefined' ) {
    const globalData = useGlobalData();
    profile = globalData[ 'people'][ 'default' ][ slug ];
  }
  
  return (
    <span style={{ textAlign: 'center', display: 'inline-block', marginLeft: 5, marginRight: 5 }} className="avatar">
      <a className={clsx("avatar__photo-link avatar__photo avatar__photo--lg", styles.circ )} href={"/people/" + profile.slug}>
        <img src={profile.image} />
      </a>
      <a href={"/people/" + profile.slug}><small style={{ color: color }} className={clsx( styles.firstname ) }>{profile.title.substr( 0, profile.title.indexOf( " " ) )}</small></a>
    </span>
  );
}
