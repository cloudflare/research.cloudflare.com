const utils = require( '@docusaurus/utils' );
const globby = require( 'globby' );
const path = require( 'path' );

module.exports = function people(context, options) {

  return {
    name: 'people',
    async loadContent() {
    
      const personProfiles = [];
      const personFiles = await globby( [ 'src/pages/people/*.mdx' ] );
      
      for ( const personFile of personFiles ) {
        const profile = await utils.parseMarkdownFile( personFile, {removeContentTitle: true} );
        
        const requiredSlug = path.basename( personFile, '.mdx' );
        
        // check slug element against filename
        if ( typeof profile.frontMatter.slug == 'undefined' || profile.frontMatter.slug != requiredSlug )
          throw new Error( personFile + " must contain a frontmatter item called 'slug' with the value '" + requiredSlug + "'" );
        
        personProfiles.push( {
          slug: profile.frontMatter.slug,
          title: profile.frontMatter.title,
          position: profile.frontMatter.position,
          status: profile.frontMatter.status,
          twitter: profile.frontMatter.twitter,
          image: profile.frontMatter.image,
          content: profile.content,
          excerpt: profile.excerpt
        } ); 
      }
    
      // sort by name
      personProfiles.sort( ( a, b ) => {
        if ( a.name > b.name ) return 1;
        else if ( a.name < b.name ) return -1;
        else return 0;
      } )
    
      return personProfiles;
      
    },
    async contentLoaded({content, actions}) {

      const {setGlobalData, createData, addRoute} = actions;
      
      let globalData = { profiles: content };
      
      // set global profile data for all profiles as an ordered array
      //setGlobalData( { profiles: content } );
      
      for ( const personProfile of content ) {
      
         // set global profile data for individual person indexed by email
        globalData[ personProfile.slug ] = personProfile;
      
        // add the data by slug
        const slugProfilePath = await createData(
          personProfile.slug + '.json',
          JSON.stringify( personProfile ),
        );
        
        /*
        // add the data by email
        const emailProfilePath = await createData(
          personProfile.email + '.json',
          JSON.stringify( personProfile ),
        );
        */
      }
     
      // actually set the global data we have accumulated
      setGlobalData( globalData );
      
      /*
        
        // add the page
        addRoute( {
          path: '/people/' + personProfile.slug,
          component: '@site/src/components/PersonProfile.js',
          modules: { profile: profilePath },
          exact: true,
        } );
        
      }
      */
    
    },

  };
};

