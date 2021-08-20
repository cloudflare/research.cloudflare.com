const fs = require( 'fs' )
const path = require( 'path' )

const yaml = require( 'js-yaml' )


function generateProjectsData() {

  let projects = {};
  
  try {
    const files = fs.readdirSync( 'projects/' );
        
    let content = ''
    for ( const file of files ) {
      
      //console.log( file )
      //console.log( path.parse( file ) )
      
      if ( typeof file !== 'undefined' && path.parse( file ).ext == '.md' && path.parse( file ).name != 'index' ) {
        let slug = path.parse( file ).name
        content = fs.readFileSync( 'projects/' + file, 'utf8' )
        
        let front= content.substr( 4, content.indexOf( '---', 4 ) - 4 )
        //console.log( front )
        
        frontMatter = yaml.load( front );
        //console.log( frontMatter )
        
        let personSlugs = frontMatter.related_profiles;
        //let personSlugs = personSlugsString.split( ',' )
        
        for ( personSlug of personSlugs ) {
          if ( typeof projects[ personSlug ] !== 'undefined' ) {
            projects[ personSlug ].push( { name: frontMatter.title, path: slug } )
          }
          else {
            projects[ personSlug ] = [ { name: frontMatter.title, path: slug } ]
          }
        }
      }
    }
     
  }
  catch (err) {
    console.error(err);
  }
  
  return projects;
}
// parse the front matter and add to 'profiles'
let projects = generateProjectsData();
//console.log( projects );

module.exports = {}
for ( personSlug in projects ) {
  module.exports[ personSlug ] = projects[ personSlug ]
}

/*
  
  projects[ 'cefan-rubin' ] 
    [ ... array of { name: 'Project Name from title frontmatter', path: 'file slug' } ... ]

*/
