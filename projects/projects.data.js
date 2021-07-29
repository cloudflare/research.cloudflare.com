const fs = require( 'fs' )
const path = require( 'path' )

const yaml = require( 'js-yaml' )


function generateNavigation() {
  let navigation = [];
  
  try {
    const files = fs.readdirSync( 'projects/' );
        
    let content = ''
    for ( const file of files ) {
            
      if ( typeof file !== 'undefined' && path.parse( file ).ext == '.md' && path.parse( file ).name != 'index' ) {
        let slug = path.parse( file ).name
        
        content = fs.readFileSync( 'projects/' + file, 'utf8' )
        
        let front= content.substr( 4, content.indexOf( '---', 4 ) - 4 )
        frontMatter = yaml.load( front );
        
        navigation.push( { path: slug, label: frontMatter.title } )
      }
    }

  }
  catch (err) {
    console.error(err);
  }
  
  return navigation;
}

let navigation = generateNavigation();
//console.log( navigation );

module.exports = {
  layout: 'content',
  navigation: navigation,
}

/*

  projects.navigation
    [ 
      { 
        path:
        label:
      },
      ...
    ]
  
*/
