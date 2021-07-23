import React from 'react';
import clsx from 'clsx';
import styles from './RelatedProfiles.module.css';
import useGlobalData from '@docusaurus/useGlobalData';

export default function RelatedProfiles( { slug } ) {
  
  const globalData = useGlobalData();
  const relatedProjects = globalData[ 'projects' ][ 'default' ][ slug ];
  
  if ( typeof relatedProjects !== 'undefined' ) {
      return (
        <ul>
        {relatedProjects.map(( project, index ) => {
          return <li key={index}><a href={project.file}>{project.name}</a></li>
        }
        
        )}
        </ul>
      );
  }
  else {
    return null;
  }
}
