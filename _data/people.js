const fs = require( 'fs' )
const path = require( 'path' )

const yaml = require( 'js-yaml' )


function generateProfiles() {

  let profiles = [];
  
  try {
    const files = fs.readdirSync( 'people/' );
        
    let content = ''
    for ( const file of files ) {
      
      //console.log( file )
      //console.log( path.parse( file ) )
      
      if ( typeof file !== 'undefined' && path.parse( file ).ext == '.md' ) {
        let slug = path.parse( file ).name
        content = fs.readFileSync( 'people/' + file, 'utf8' )
        
        let front= content.substr( 4, content.indexOf( '---', 4 ) - 4 )
        //console.log( front )
        
        frontMatter = yaml.load( front );
        //console.log( frontMatter )
        frontMatter.slug = slug
        
        profiles.push( frontMatter )
      }
    }
     
  }
  catch (err) {
    console.error(err);
  }
  
  return profiles;
}
// parse the front matter and add to 'profiles'
let profiles = generateProfiles();
//console.log( profiles );

module.exports = {
  'ordered': profiles
}

for ( profile of profiles ) {
  module.exports[ profile.slug ] = profile
}

//console.log( module.exports )

/*

  people.ordered
    [ ... alphabetical array of all profiles ... ]
  
  people[ 'cefan-rubin' ] 
    { ... frontmatter from people/cefan-rubin.md ... }

*/
