const utils = require( '@docusaurus/utils' );
const globby = require( 'globby' );
const path = require( 'path' );

module.exports = function projects(context, options) {

  return {
    name: 'projects',
    async loadContent() {
    
      let projectRelatedBySlug = {};
      const projectFiles = await globby( [ 'docs/*.md' ] );
      
      for ( const projectFile of projectFiles ) {
        const project = await utils.parseMarkdownFile( projectFile, {removeContentTitle: true} );
        const related_slugs = String( project.frontMatter.related_profiles );
        
        //console.log( projectFile + " - '" + related_slugs + "'" );
        
        // check slug element against filename
        if ( typeof related_slugs == 'undefined' || related_slugs.trim() == '' || related_slugs == 'undefined' )
          throw new Error( projectFile + " must contain a frontmatter item called 'related_profiles' containing a comma separated list of profile slugs" );

        
        const slugArray = String(related_slugs).split( ',' );
        
        if ( slugArray.length > 0 ) {
          for ( const slug of slugArray ) {
            if ( typeof projectRelatedBySlug[ slug ] == 'undefined' )
              projectRelatedBySlug[ slug ] = [];
              
            projectRelatedBySlug[ slug ].push( { name: project.frontMatter.title, file: "/docs/" + path.basename( projectFile, '.md' ) } );
          }
        }
      }
      
      return projectRelatedBySlug;
      
    },
    async contentLoaded({content, actions}) {

      const {setGlobalData, createData, addRoute} = actions;
      setGlobalData( content );
      
    },

  };
};

